// lib/fault.ts
// Server-only Fault Injector: creates exam questions by breaking a correct
// program in exactly one place. NEVER import in a client component.
import OpenAI from "openai";
import { meta } from "./meta";
import { simulate } from "./sim/index";
import { supabase } from "./supabase";

const MAX_TOKENS = 16384;
const MAX_ATTEMPTS = 4; // initial try + up to 3 retries

export interface Fault {
  faulty_program: string;
  changed_line: number;
  hint: string;
  model: string;
  crash_type: string;
}

interface FaultClient {
  client: OpenAI;
  model: string;
  openPath: boolean;
}

function getFaultClient(): FaultClient {
  const baseURL = process.env.OPEN_MODEL_BASE_URL;
  if (baseURL) {
    const model = process.env.OPEN_MODEL_ID;
    if (!model) throw new Error("OPEN_MODEL_BASE_URL is set but OPEN_MODEL_ID is missing");
    return {
      client: new OpenAI({ baseURL, apiKey: process.env.OPEN_MODEL_API_KEY }),
      model,
      openPath: true,
    };
  }
  return { client: meta, model: "muse-spark-1.3", openPath: false };
}

const SYSTEM =
  "Create an exam question for CNC trainees. Change the given correct program in ONE place so it causes exactly the requested crash type, the way a real trainee gets it wrong. Keep every other line identical. Reply with only a JSON object { faulty_program, changed_line, hint } where hint does not give the answer away.";

// Search guidance for the retry message only. Acceptance is still decided
// by the simulator alone.
const RETRY_HINTS: Record<string, string> = {
  RAPID_INTO_VISE:
    "Note: the vise jaws sit outside the stock footprint (front jaw Y -15..0, back jaw Y 80..95, both Z -40..-10). One changed block can rapid outside the stock in XY and below Z-10 at the same time, e.g. a G00 move that leaves the stock area sideways while also going down.",
};

function extractJson(content: string): {
  faulty_program: string;
  changed_line: number;
  hint: string;
} {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model reply");
  const parsed = JSON.parse(content.slice(start, end + 1)) as {
    faulty_program?: unknown;
    changed_line?: unknown;
    hint?: unknown;
  };
  if (
    typeof parsed.faulty_program !== "string" ||
    typeof parsed.changed_line !== "number" ||
    typeof parsed.hint !== "string"
  ) {
    throw new Error("Model reply JSON has wrong shape");
  }
  return {
    faulty_program: parsed.faulty_program,
    changed_line: parsed.changed_line,
    hint: parsed.hint,
  };
}

export async function generateFault(
  program: string,
  crashType: string,
): Promise<Fault> {
  const base = simulate(program);
  if (!base.ok) {
    throw new Error(
      `Base program is not ok: ${JSON.stringify(base.crash ?? base.parseErrors)}`,
    );
  }

  const { client, model, openPath } = getFaultClient();
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Correct program:\n${program}\n\nRequested crash type: ${crashType}`,
    },
  ];

  let lastDetail = "";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const extra: { reasoning_effort?: "medium" } = openPath
      ? { reasoning_effort: "medium" }
      : {};
    const started = Date.now();
    const response = await client.chat.completions.create({
      model,
      max_tokens: MAX_TOKENS,
      messages,
      ...extra,
    });
    console.log(
      `[fault] ${crashType} attempt ${attempt}: chat.completions.create took ${Date.now() - started}ms`,
    );
    const content = response.choices[0]?.message?.content ?? "";
    messages.push({ role: "assistant", content });

    let candidate: { faulty_program: string; changed_line: number; hint: string };
    try {
      candidate = extractJson(content);
    } catch (e) {
      lastDetail = e instanceof Error ? e.message : String(e);
      messages.push({
        role: "user",
        content: `Your reply was not valid JSON (${lastDetail}). Reply with only the JSON object.`,
      });
      continue;
    }

    const check = simulate(candidate.faulty_program);
    if (check.crash?.type === crashType) {
      const row = {
        crash_type: crashType,
        base_program: program,
        faulty_program: candidate.faulty_program,
        changed_line: candidate.changed_line,
        hint: candidate.hint,
        model,
      };
      const { error } = await supabase.from("exam_faults").insert(row);
      if (error) throw new Error(`Saving fault failed: ${error.message}`);
      console.log(`[fault] ${crashType} accepted (changed line ${candidate.changed_line})`);
      return { ...row };
    }
    lastDetail = check.crash
      ? `crash type ${check.crash.type} at line ${check.crash.line}`
      : check.parseErrors.length > 0
        ? `parse errors ${JSON.stringify(check.parseErrors)}`
        : "no crash (program runs clean)";
    console.log(`[fault] ${crashType} attempt ${attempt} rejected: ${lastDetail}`);
    const nudge = RETRY_HINTS[crashType] ? ` ${RETRY_HINTS[crashType]}` : "";
    messages.push({
      role: "user",
      content: `The simulator returned ${lastDetail}, but the requested crash type is ${crashType}. Try again with a different one-place change.${nudge} Reply with only the JSON object.`,
    });
  }

  throw new Error(`No accepted fault after ${MAX_ATTEMPTS} attempts (last: ${lastDetail})`);
}

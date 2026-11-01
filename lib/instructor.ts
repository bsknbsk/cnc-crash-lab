// lib/instructor.ts
// Server-only Instructor agent: a senior-CNC-setter debrief built on the
// Meta Model API (Responses API) with simulator-backed tools.
// NEVER import this module in a client component.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  FunctionTool,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import { meta } from "./meta";
import { simulate } from "./sim/index";
import type { CrashEvent } from "./sim/types";
import { quoteCost } from "./cost";

const MODEL = "muse-spark-1.3";
const MAX_TURNS = 6;
const UNKNOWN_CODE = "Not in the reference table. Do not guess its meaning.";

export interface TraceStep {
  name: string;
  arguments: unknown;
  summary: string;
}

export interface DebriefResult {
  debrief: string;
  trace: TraceStep[];
}

const tools: FunctionTool[] = [
  {
    type: "function",
    name: "run_sim",
    description:
      "Run the CNC simulator on a G-code program. Returns the SimResult: ok, crash details (type, line, block, position) or parse errors.",
    parameters: {
      type: "object",
      properties: {
        program: {
          type: "string",
          description: "The full G-code program text to simulate.",
        },
      },
      required: ["program"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "lookup_gcode",
    description:
      "Look up the meaning of one Fanuc 0i G or M code in the reference table.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The code to look up, e.g. G43 or M03.",
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "quote_cost",
    description:
      "Get the repair cost row (INR range, downtime hours, damaged parts) for a crash type from the repair_costs table.",
    parameters: {
      type: "object",
      properties: {
        crash_type: {
          type: "string",
          description:
            "The crash type, e.g. MISSING_G43, WRONG_WORK_OFFSET, RAPID_INTO_STOCK, RAPID_INTO_VISE, FEED_SPINDLE_OFF.",
        },
      },
      required: ["crash_type"],
      additionalProperties: false,
    },
    strict: true,
  },
];

let reference: Record<string, string> | null = null;

function lookupGcode(code: string): string {
  if (!reference) {
    reference = JSON.parse(
      readFileSync(join(process.cwd(), "data", "gcode-reference.json"), "utf8"),
    ) as Record<string, string>;
  }
  const key = String(code).trim().toUpperCase().replace(/^([GM])(\d)$/, "$10$2");
  return reference[key] ?? UNKNOWN_CODE;
}

function oneLine(value: unknown, max = 120): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

async function dispatch(
  name: string,
  args: Record<string, string>,
): Promise<{ result: unknown; summary: string }> {
  if (name === "run_sim") {
    const r = simulate(args.program ?? "");
    const summary = r.ok
      ? `ok, no crash, ${r.linesExecuted} lines`
      : r.crash
        ? `crash ${r.crash.type} at line ${r.crash.line}`
        : `parse errors: ${r.parseErrors.length}`;
    return { result: r, summary };
  }
  if (name === "lookup_gcode") {
    const meaning = lookupGcode(args.code ?? "");
    return { result: meaning, summary: `${args.code}: ${oneLine(meaning, 90)}` };
  }
  if (name === "quote_cost") {
    const q = await quoteCost(args.crash_type ?? "");
    const summary =
      "error" in q
        ? q.error
        : `${q.crash_type}: INR ${q.min_inr}–${q.max_inr}, ${q.downtime_hours}h downtime`;
    return { result: q, summary };
  }
  return { result: `Unknown tool ${name}`, summary: `unknown tool ${name}` };
}

const SYSTEM = `You are a senior CNC setter with 20 years on Fanuc 0i VMCs, training a new operator after a crash. The simulator is the only judge of crashes: never declare a program safe or crashed without run_sim, and never explain a G or M code from memory.
Work in this order:
1. Call lookup_gcode for every G and M code in the crashing block and in the setup lines before it.
2. Call quote_cost with the crash type. Only state prices, downtime and damaged parts it returns.
3. Write a corrected program and call run_sim on it. If it is not ok, fix it and rerun until run_sim returns ok.
Answer under 180 words outside the program, with exactly these sections:
WHAT HAPPENED
ROOT CAUSE (line number and block text)
REPAIR COST (INR range, downtime hours, damaged parts from quote_cost)
FIXED PROGRAM (the version that passed run_sim, in a single \`\`\`gcode fenced block and nowhere else)
HABIT (one shop-floor habit that prevents this crash)`;

export async function runInstructor(
  program: string,
  crash: CrashEvent | null,
): Promise<DebriefResult> {
  const trace: TraceStep[] = [];
  let input: ResponseInputItem[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Crashed program:\n${program}\n\nSimulator crash report:\n${JSON.stringify(crash)}`,
    },
  ];
  let previousId: string | undefined;
  let debrief = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await meta.responses.create({
      model: MODEL,
      reasoning: { effort: "medium" },
      tools,
      input,
      ...(previousId ? { previous_response_id: previousId } : {}),
    });
    previousId = response.id;
    debrief = response.output_text;
    const calls = response.output.filter((o) => o.type === "function_call");
    if (calls.length === 0) break;
    const outputs: ResponseInputItem[] = [];
    for (const call of calls) {
      const args = JSON.parse(call.arguments) as Record<string, string>;
      const { result, summary } = await dispatch(call.name, args);
      trace.push({ name: call.name, arguments: args, summary });
      outputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }
    input = outputs;
  }

  return { debrief, trace };
}

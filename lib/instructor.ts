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
const SIM_TIMEOUT_MS = 2000;
const UNKNOWN_CODE = "Not in the reference table. Do not guess its meaning.";

export type InstructorEvent =
  | { type: "thinking"; turn: number }
  | { type: "step"; tool: string; args: unknown; summary: string; ms: number }
  | { type: "done"; debrief: string }
  | { type: "error"; message: string };

export type EmitEvent = (event: InstructorEvent) => void;

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
      "Get the repair cost row (INR range, downtime hours, damaged parts, shop habit) for a crash type from the repair_costs table.",
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

function runSimGuarded(
  program: string,
): Promise<ReturnType<typeof simulate> | { error: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ error: "Simulation exceeded 2 s, program too long" }),
      SIM_TIMEOUT_MS,
    );
    let out: ReturnType<typeof simulate>;
    try {
      out = simulate(program);
    } catch (e) {
      clearTimeout(timer);
      resolve({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    clearTimeout(timer);
    resolve(out);
  });
}

function summarizeSim(r: ReturnType<typeof simulate> | { error: string }): string {
  if ("error" in r && !("ok" in r)) return r.error;
  const s = r as ReturnType<typeof simulate>;
  return s.ok
    ? `ok, no crash, ${s.linesExecuted} lines`
    : s.crash
      ? `crash ${s.crash.type} at line ${s.crash.line}`
      : `parse errors: ${s.parseErrors.length}`;
}

async function dispatch(
  name: string,
  args: Record<string, string>,
): Promise<{ result: unknown; summary: string }> {
  if (name === "run_sim") {
    const r = await runSimGuarded(args.program ?? "");
    return { result: r, summary: summarizeSim(r) };
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

const SYSTEM = `You are a senior CNC setter with 20 years on Fanuc 0i VMCs, training a new operator after a crash. The simulator is the only judge of crashes: never declare a program safe or crashed without run_sim, and never explain a G or M code from memory. Be fast: make every independent tool call in the same turn.
In the FIRST turn, call lookup_gcode ONLY for the listed "Codes to explain" (at most 4 lookups) AND call quote_cost with the crash type, all together as parallel tool calls. Do not look up any other code.
Then write a corrected program and call run_sim on it. If it is not ok, fix it and rerun until run_sim returns ok. In the fixed program, write tool length blocks in shop convention order: motion, G43, Z, H, then M codes, e.g. "G00 G43 Z25. H01 M08".
Then answer.
Answer under 180 words outside the program, with exactly these sections. Put each section header on its own line, followed by the content on the following lines. Never repeat a header inside its content.
WHAT HAPPENED (exactly three lines, using only crash-event facts, computing nothing yourself. If zErrorMm is not 0 (the tool was lower than intended):
"Commanded <block> = target Z<commandedTarget.z> in <offset>."
"Actual tip target Z<actualTarget.z>, <abs(zErrorMm)> mm low."
"First contact with <collidedWith> at Z<position.z> on the way down."
If zErrorMm is 0 and the move has X or Y travel (a sideways move at the wrong height):
"Commanded <block>: <motion> move in X/Y at Z<position.z>."
"The tool was still at Z<position.z>, below the top of the <collidedWith>, with no retract before the move."
"First contact with <collidedWith> at X<position.x> Y<position.y>.")
CRASH LINE (content format "line <n>: <block>" using the line number and block from the crash event, where the impact happened)
ROOT CAUSE (content format "line <n>: <block> - <one sentence linking this mistake to the crash>". The mistake can be on a different line from the crash line; explain the link in one sentence)
REPAIR COST (INR range, downtime hours, damaged parts, from quote_cost only)
FIXED PROGRAM (change ONLY the root cause line(s); every other line stays exactly as the student wrote it. The fixed program must pass run_sim, in a single \`\`\`gcode fenced block and nowhere else)
HABIT (the habit text from quote_cost, word for word. Do not write your own habit)`;

export async function runInstructor(
  program: string,
  crash: CrashEvent | null,
  emit: EmitEvent = () => {},
  codesToExplain: string[] = [],
): Promise<DebriefResult> {
  const trace: TraceStep[] = [];
  let input: ResponseInputItem[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Crashed program:\n${program}\n\nSimulator crash report:\n${JSON.stringify(crash)}\nCodes to explain: ${codesToExplain.join(", ")}`,
    },
  ];
  let previousId: string | undefined;
  let debrief = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    emit({ type: "thinking", turn });
    const createStarted = Date.now();
    const response = await meta.responses.create({
      model: MODEL,
      reasoning: { effort: "low" },
      tools,
      input,
      ...(previousId ? { previous_response_id: previousId } : {}),
    });
    console.log(
      `[instructor] turn ${turn}: responses.create took ${Date.now() - createStarted}ms`,
    );
    previousId = response.id;
    debrief = response.output_text;
    const calls = response.output.filter((o) => o.type === "function_call");
    if (calls.length === 0) break;
    console.log(`[instructor] turn ${turn}: ${calls.length} tool call(s)`);
    const outputs = await Promise.all(
      calls.map(async (call) => {
        const args = JSON.parse(call.arguments) as Record<string, string>;
        const toolStarted = Date.now();
        const { result, summary } = await dispatch(call.name, args);
        const ms = Date.now() - toolStarted;
        console.log(
          `[instructor] turn ${turn}: tool ${call.name} took ${ms}ms`,
        );
        trace.push({ name: call.name, arguments: args, summary });
        emit({ type: "step", tool: call.name, args, summary, ms });
        return {
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result),
        } as ResponseInputItem;
      }),
    );
    input = outputs;
  }

  return { debrief, trace };
}

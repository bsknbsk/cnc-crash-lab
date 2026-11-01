import { runInstructor } from "../../../lib/instructor";

// Codes the model must explain per crash type (passed into the prompt;
// the system message forbids looking up anything else).
const CRASH_CODES: Record<string, string[]> = {
  MISSING_G43: ["G43", "M06"],
  WRONG_WORK_OFFSET: ["G54", "G55"],
  RAPID_INTO_STOCK: ["G00", "G43"],
  RAPID_INTO_VISE: ["G00"],
  FEED_SPINDLE_OFF: ["M03", "G01"],
};

export const maxDuration = 300;

export async function POST(req: Request) {
  const { program, crash } = (await req.json()) as {
    program: string;
    crash: Parameters<typeof runInstructor>[1];
  };
  console.log("[instructor] request started");
  const codesToExplain =
    crash && typeof crash.type === "string"
      ? (CRASH_CODES[crash.type] ?? [])
      : [];
  console.log(
    `[instructor] codes to explain for ${crash?.type}: ${codesToExplain.join(", ")}`,
  );

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(
          new TextEncoder().encode(`${JSON.stringify(event)}\n`),
        );
      };
      try {
        const { debrief } = await runInstructor(
          program,
          crash,
          (event) => {
            if (event.type === "thinking" || event.type === "step") send(event);
          },
          codesToExplain,
        );
        send({ type: "done", debrief });
        console.log("[instructor] request finished, stream closed");
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.log(`[instructor] request failed: ${message}`);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

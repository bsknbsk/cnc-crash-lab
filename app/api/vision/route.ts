import { meta } from "../../../lib/meta";
import { simulate } from "../../../lib/sim/index";

export const maxDuration = 60;

const PROMPT =
  "Transcribe the handwritten or printed Fanuc milling program exactly as written, one block per line, top to bottom. " +
  "Keep block numbers if written. " +
  "Do not correct any mistake: the student must find mistakes on the simulator. " +
  "List line numbers that were hard to read in unclear_lines.";

export async function POST(req: Request) {
  const started = Date.now();
  const form = await req.formData();
  const image = form.get("image");
  if (!(image instanceof File)) {
    return Response.json({ error: 'Missing multipart field "image"' }, { status: 400 });
  }
  console.log(`[vision] received ${(image as File).size} bytes (${(image as File).type})`);

  const bytes = Buffer.from(await (image as File).arrayBuffer());
  const dataUrl = `data:${(image as File).type || "image/jpeg"};base64,${bytes.toString("base64")}`;

  const response = await meta.responses.create({
    model: "muse-spark-1.3",
    reasoning: { effort: "low" },
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: PROMPT },
          { type: "input_image", image_url: dataUrl, detail: "auto" },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "program_sheet",
        strict: true,
        schema: {
          type: "object",
          properties: {
            program: { type: "string" },
            unclear_lines: { type: "array", items: { type: "integer" } },
          },
          required: ["program", "unclear_lines"],
          additionalProperties: false,
        },
      },
    },
  });
  console.log(`[vision] responses.create took ${Date.now() - started}ms`);

  let parsed: { program: string; unclear_lines: number[] };
  try {
    parsed = JSON.parse(response.output_text) as {
      program: string;
      unclear_lines: number[];
    };
  } catch {
    console.log("[vision] model output was not valid JSON");
    return Response.json({ error: "Model did not return valid JSON" }, { status: 502 });
  }

  const sim = simulate(parsed.program ?? "");
  const ms = Date.now() - started;
  console.log(`[vision] done in ${ms}ms, parse errors: ${sim.parseErrors.length}`);
  return Response.json({
    program: parsed.program ?? "",
    unclear_lines: parsed.unclear_lines ?? [],
    parseErrors: sim.parseErrors,
    ms,
  });
}

import { generateFault } from "../../../lib/fault";

export const maxDuration = 120;

export async function POST(req: Request) {
  const { program, crashType } = (await req.json()) as {
    program: string;
    crashType: string;
  };
  console.log(`[fault] request started for ${crashType}`);
  try {
    const fault = await generateFault(program, crashType);
    console.log(`[fault] request finished for ${crashType}`);
    return Response.json(fault);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`[fault] request failed for ${crashType}: ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}

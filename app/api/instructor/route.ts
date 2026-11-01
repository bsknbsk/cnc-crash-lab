import { NextResponse } from "next/server";
import { runInstructor } from "../../../lib/instructor";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { program, crash } = (await req.json()) as {
    program: string;
    crash: Parameters<typeof runInstructor>[1];
  };
  const { debrief, trace } = await runInstructor(program, crash);
  return NextResponse.json({ debrief, trace });
}

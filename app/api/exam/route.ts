import { connection } from "next/server";
import { supabase } from "../../../lib/supabase";

export async function GET(req: Request) {
  await connection();
  const exclude =
    new URL(req.url).searchParams
      .get("exclude")
      ?.split(",")
      .map(Number)
      .filter((n) => Number.isFinite(n)) ?? [];
  const { data, error } = await supabase
    .from("exam_faults")
    .select("id, crash_type, faulty_program, changed_line, hint, model");
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  const total = data?.length ?? 0;
  const pool = (data ?? []).filter((r) => !exclude.includes(r.id));
  if (pool.length === 0) {
    return Response.json({ question: null, total });
  }
  return Response.json({
    question: pool[Math.floor(Math.random() * pool.length)],
    total,
  });
}

import { connection } from "next/server";
import { supabase } from "../../../lib/supabase";

export async function GET() {
  await connection();
  const { data, error } = await supabase
    .from("exam_faults")
    .select("crash_type, faulty_program, changed_line, hint, model");
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return Response.json({ error: "No exam faults yet" }, { status: 404 });
  }
  return Response.json(data[Math.floor(Math.random() * data.length)]);
}

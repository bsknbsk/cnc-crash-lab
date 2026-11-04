import { connection } from "next/server";
import { supabase } from "../../../lib/supabase";
import { quoteCost } from "../../../lib/cost";

export async function GET(req: Request) {
  await connection();
  const type = new URL(req.url).searchParams.get("type");
  if (!type) {
    console.log("[cost] full table preload");
    const { data, error } = await supabase
      .from("repair_costs")
      .select("crash_type, min_inr, max_inr, downtime_hours, damaged_parts")
      .order("crash_type");
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    return Response.json(data ?? []);
  }
  console.log(`[cost] quote for ${type}`);
  const q = await quoteCost(type);
  if ("error" in q) {
    console.log(`[cost] no row for ${type}`);
    return Response.json({ error: q.error }, { status: 404 });
  }
  return Response.json({
    min_inr: q.min_inr,
    max_inr: q.max_inr,
    downtime_hours: q.downtime_hours,
    damaged_parts: q.damaged_parts,
  });
}

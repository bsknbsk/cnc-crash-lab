// lib/cost.ts
// Repair-cost quotes. Prices come only from the Supabase table
// repair_costs; never invent them.
import { supabase } from "./supabase";

export interface CostQuote {
  crash_type: string;
  damaged_parts: string | null;
  min_inr: number | null;
  max_inr: number | null;
  downtime_hours: number | null;
  habit: string | null;
}

export async function quoteCost(
  crashType: string,
): Promise<CostQuote | { error: string }> {
  const { data, error } = await supabase
    .from("repair_costs")
    .select("crash_type, damaged_parts, min_inr, max_inr, downtime_hours, habit")
    .eq("crash_type", crashType)
    .single();

  // .single() reports code PGRST116 when no row matches.
  if (error && error.code !== "PGRST116") {
    return { error: error.message };
  }
  if (!data) {
    return { error: `No cost row for ${crashType}` };
  }
  return data as CostQuote;
}

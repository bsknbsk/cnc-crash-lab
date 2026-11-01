import { NextResponse, connection } from "next/server";
import { supabase } from "../../../lib/supabase";

export async function GET() {
  // Opt out of build-time caching under cacheComponents (no `dynamic`
  // route segment config); runs fresh on every request.
  await connection();

  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  const result: Record<string, unknown> = {
    supabaseUrlSet: Boolean(url),
    supabaseSecretKeySet: Boolean(secret),
    modelApiKeySet: Boolean(process.env.MODEL_API_KEY),
    supabaseHost: url ? new URL(url).host : null,
    secretKeyStartsWithSbSecret: Boolean(secret?.startsWith("sb_secret_")),
    repairCostRows: 0,
    crashTypes: [] as string[],
    supabaseError: null as string | null,
  };

  if (url && secret) {
    const { data, error } = await supabase
      .from("repair_costs")
      .select("crash_type")
      .order("crash_type");
    result.repairCostRows = data?.length ?? 0;
    result.crashTypes = data?.map((r) => r.crash_type) ?? [];
    result.supabaseError = error?.message ?? null;
  }

  return NextResponse.json(result);
}

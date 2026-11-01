// lib/supabase.ts
// Server-only Supabase client (Vercel Supabase integration env vars).
// NEVER import this module in a client component: it carries
// SUPABASE_SECRET_KEY, which must never reach the browser.
import { createClient } from "@supabase/supabase-js";

function mustGet(name: "SUPABASE_URL" | "SUPABASE_SECRET_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} (Vercel Supabase integration)`);
  }
  return value;
}

export const supabase = createClient(
  mustGet("SUPABASE_URL"),
  mustGet("SUPABASE_SECRET_KEY"),
);

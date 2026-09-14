import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { clientEnv, getServerEnv } from "@/lib/env";

let cached: SupabaseClient | null = null;

/** Server-only service-role client. Never expose this client to the browser. */
export function createAdminClient(): SupabaseClient {
  if (cached) return cached;

  cached = createClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    getServerEnv().SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return cached;
}

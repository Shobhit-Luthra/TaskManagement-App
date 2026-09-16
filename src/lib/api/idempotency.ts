import { createAdminClient } from "@/lib/supabase/admin";

export async function withIdempotency<T>(
  params: { userId: string; key: string; requestHash: string },
  run: () => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T }> {
  const admin = createAdminClient();
  const existing = await admin
    .from("idempotency_keys")
    .select("request_hash, status, response")
    .eq("user_id", params.userId)
    .eq("key", params.key)
    .maybeSingle();

  if (existing.data && existing.data.request_hash === params.requestHash) {
    return { status: existing.data.status, body: existing.data.response as T };
  }

  const result = await run();
  await admin.from("idempotency_keys").upsert({
    user_id: params.userId,
    key: params.key,
    request_hash: params.requestHash,
    status: result.status,
    response: result.body as object,
  });
  return result;
}

import type { SupabaseClient } from "@supabase/supabase-js";

export type RateLimitPolicy = { name: string; limit: number; windowSeconds: number };
export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: Date };

export const RATE_LIMITS = {
  writes: { name: "writes", limit: 100, windowSeconds: 60 },
  reads: { name: "reads", limit: 300, windowSeconds: 60 },
  invitations: { name: "invitations", limit: 20, windowSeconds: 3600 },
  analytics: { name: "analytics", limit: 30, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitPolicy>;

export async function consumeRateLimit(
  policy: RateLimitPolicy,
  subject: string,
  client?: SupabaseClient,
): Promise<RateLimitResult> {
  const rateLimitClient = client ?? (await import("@/lib/supabase/admin")).createAdminClient();
  const { data, error } = await rateLimitClient.rpc("consume_rate_limit", {
    p_key: `${policy.name}:${subject}`,
    p_limit: policy.limit,
    p_window_seconds: policy.windowSeconds,
  });
  const row = Array.isArray(data) ? data[0] : data;

  if (error || !row) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + policy.windowSeconds * 1000),
    };
  }

  return { allowed: row.allowed, remaining: row.remaining, resetAt: new Date(row.reset_at) };
}

export function ipSubject(request: Request): string {
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `ip:${first || "unknown"}`;
}

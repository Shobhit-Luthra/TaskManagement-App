import { describe, expect, it, vi } from "vitest";
import { consumeRateLimit, ipSubject } from "./rate-limit";

function fakeClient(
  result: { allowed: boolean; remaining: number; reset_at: string } | null,
  error: unknown = null,
) {
  return { rpc: vi.fn(async () => ({ data: result ? [result] : null, error })) };
}

describe("consumeRateLimit", () => {
  const policy = { name: "writes", limit: 100, windowSeconds: 60 };

  it("calls the RPC with a namespaced key and returns the decision", async () => {
    const client = fakeClient({
      allowed: true,
      remaining: 99,
      reset_at: "2026-09-11T00:01:00.000Z",
    });
    const result = await consumeRateLimit(policy, "user-1", client as never);
    expect(client.rpc).toHaveBeenCalledWith("consume_rate_limit", {
      p_key: "writes:user-1",
      p_limit: 100,
      p_window_seconds: 60,
    });
    expect(result).toEqual({
      allowed: true,
      remaining: 99,
      resetAt: new Date("2026-09-11T00:01:00.000Z"),
    });
  });

  it("fails closed when the RPC errors", async () => {
    const client = fakeClient(null, { code: "XX000" });
    const result = await consumeRateLimit(policy, "user-1", client as never);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});

describe("ipSubject", () => {
  it("uses the first hop of x-forwarded-for", () => {
    const request = new Request("http://x", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(ipSubject(request)).toBe("ip:203.0.113.9");
  });
  it("falls back to unknown", () => {
    expect(ipSubject(new Request("http://x"))).toBe("ip:unknown");
  });
});

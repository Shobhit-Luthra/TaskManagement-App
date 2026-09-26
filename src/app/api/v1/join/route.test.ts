import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  },
}));

const { getUser, rpc } = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, rpc }),
}));

const { consumeRateLimit } = vi.hoisted(() => ({ consumeRateLimit: vi.fn() }));
vi.mock("@/lib/api/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/rate-limit")>();
  return { ...actual, consumeRateLimit: (...args: unknown[]) => consumeRateLimit(...args) };
});

import { INVALID_CODE_MESSAGE } from "@/lib/join-codes/schemas";
import { POST } from "./route";

const allowed = { allowed: true, remaining: 5, resetAt: new Date() };
const blocked = { allowed: false, remaining: 0, resetAt: new Date() };

function request(body: unknown, ip = "203.0.113.7") {
  return new NextRequest("http://localhost:3000/api/v1/join", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "user-1" } } });
  rpc.mockReset();
  consumeRateLimit.mockReset().mockResolvedValue(allowed);
});

describe("POST /api/v1/join", () => {
  it("rejects a malformed code before touching the database or rate limits", async () => {
    const res = await POST(request({ code: "12ab56" }), ctx);
    expect(res.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });

  it("checks the per-user, daily and per-IP limits", async () => {
    rpc.mockResolvedValue({
      data: [{ request_id: "r1", project_name: "Apollo", status: "pending" }],
      error: null,
    });
    const res = await POST(request({ code: "123456" }), ctx);
    expect(res.status).toBe(202);
    const subjects = consumeRateLimit.mock.calls.map(([policy, subject]) => [policy.name, subject]);
    expect(subjects).toEqual([
      ["join-code", "user-1"],
      ["join-code-daily", "user-1"],
      ["join-code-ip", "ip:203.0.113.7"],
    ]);
    expect(await res.json()).toEqual({
      data: { requestId: "r1", projectName: "Apollo", status: "pending" },
    });
  });

  it("returns 429 without calling the RPC when the IP limit is exhausted", async () => {
    consumeRateLimit.mockImplementation(async (policy: { name: string }) =>
      policy.name === "join-code-ip" ? blocked : allowed,
    );
    const res = await POST(request({ code: "123456" }), ctx);
    expect(res.status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 429 when the daily limit is exhausted", async () => {
    consumeRateLimit.mockImplementation(async (policy: { name: string }) =>
      policy.name === "join-code-daily" ? blocked : allowed,
    );
    const res = await POST(request({ code: "123456" }), ctx);
    expect(res.status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("gives the same 404 body for every invalid-code case", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "INVALID_CODE" } });
    const first = await POST(request({ code: "111111" }), ctx);
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "INVALID_CODE_FORMAT" },
    });
    const second = await POST(request({ code: "222222" }), ctx);
    expect(first.status).toBe(404);
    expect(second.status).toBe(404);
    const [a, b] = [await first.json(), await second.json()];
    expect(a).toEqual(b);
    expect(a.error.message).toBe(INVALID_CODE_MESSAGE);
  });

  it("returns 409 for an existing member", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "ALREADY_MEMBER" } });
    const res = await POST(request({ code: "123456" }), ctx);
    expect(res.status).toBe(409);
  });
});

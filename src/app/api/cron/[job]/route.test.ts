import { beforeEach, describe, expect, it, vi } from "vitest";

const { claimJobRun, finishJobRun } = vi.hoisted(() => ({
  claimJobRun: vi.fn(),
  finishJobRun: vi.fn(),
}));
vi.mock("@/lib/cron/job-runs", () => ({ claimJobRun, finishJobRun }));

const { flushNotificationQueue } = vi.hoisted(() => ({ flushNotificationQueue: vi.fn() }));
vi.mock("@/lib/notifications/flush", () => ({ flushNotificationQueue }));

process.env.CRON_SECRET = "test-cron-secret";

import { POST } from "./route";

function request(job: string, opts: { secret?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.secret !== null) headers.authorization = `Bearer ${opts.secret ?? "test-cron-secret"}`;
  return {
    req: new Request(`http://localhost/api/cron/${job}`, {
      method: "POST",
      headers,
      body: JSON.stringify(opts.body ?? {}),
    }),
    ctx: { params: Promise.resolve({ job }) },
  };
}

beforeEach(() => {
  claimJobRun.mockReset().mockResolvedValue({ claimed: true });
  finishJobRun.mockReset();
  flushNotificationQueue.mockReset().mockResolvedValue({ sent: 1, failed: 0 });
});

describe("POST /api/cron/[job]", () => {
  it("401s on a missing or wrong secret", async () => {
    const { req, ctx } = request("notification-flush", { secret: "wrong" });
    const res = await POST(req as never, ctx);
    expect(res.status).toBe(401);
    expect(claimJobRun).not.toHaveBeenCalled();
  });

  it("404s on an unknown job name", async () => {
    const { req, ctx } = request("not-a-job");
    const res = await POST(req as never, ctx);
    expect(res.status).toBe(404);
  });

  it("runs the job, claims and finishes it, and returns its result", async () => {
    const { req, ctx } = request("notification-flush", { body: { run_key: "2026-01-01T00" } });
    const res = await POST(req as never, ctx);
    expect(res.status).toBe(200);
    expect(claimJobRun).toHaveBeenCalledWith("notification-flush", "2026-01-01T00");
    expect(flushNotificationQueue).toHaveBeenCalled();
    expect(finishJobRun).toHaveBeenCalledWith("notification-flush", "2026-01-01T00");
    const json = await res.json();
    expect(json).toEqual({ ok: true, result: { sent: 1, failed: 0 } });
  });

  it("is a no-op when the run key was already claimed (duplicate delivery)", async () => {
    claimJobRun.mockResolvedValueOnce({ claimed: false });
    const { req, ctx } = request("notification-flush");
    const res = await POST(req as never, ctx);
    expect(res.status).toBe(200);
    expect(flushNotificationQueue).not.toHaveBeenCalled();
  });

  it("records the error and returns 500 when the job throws", async () => {
    flushNotificationQueue.mockRejectedValueOnce(new Error("boom"));
    const { req, ctx } = request("notification-flush", { body: { run_key: "k1" } });
    const res = await POST(req as never, ctx);
    expect(res.status).toBe(500);
    expect(finishJobRun).toHaveBeenCalledWith("notification-flush", "k1", "boom");
  });
});

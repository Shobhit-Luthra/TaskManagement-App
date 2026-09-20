import { afterEach, describe, expect, it, vi } from "vitest";

const { maybeSingle, from, captureMessage } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eq2 = vi.fn(() => ({ maybeSingle }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ select }));
  const captureMessage = vi.fn();
  return { maybeSingle, from, captureMessage };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));
vi.mock("@sentry/nextjs", () => ({ captureMessage }));

import { POST } from "./route";

function request(auth?: string) {
  return new Request("http://localhost/api/cron/snapshot-heartbeat", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  }) as never;
}

describe("POST /api/cron/snapshot-heartbeat", () => {
  afterEach(() => vi.clearAllMocks());

  it("401s with no header", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
  });

  it("401s with a wrong secret", async () => {
    process.env.CRON_SECRET = "correct-secret";
    const response = await POST(request("Bearer wrong"));
    expect(response.status).toBe(401);
  });

  it("reports ok:false and alerts Sentry when today's run is missing", async () => {
    process.env.CRON_SECRET = "correct-secret";
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await POST(request("Bearer correct-secret"));
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(captureMessage).toHaveBeenCalledWith(
      "board_snapshot job missed or errored",
      expect.objectContaining({ level: "error" }),
    );
  });

  it("reports ok:true and does not alert when today's run finished cleanly", async () => {
    process.env.CRON_SECRET = "correct-secret";
    maybeSingle.mockResolvedValue({
      data: { finished_at: new Date().toISOString(), error: null },
      error: null,
    });
    const response = await POST(request("Bearer correct-secret"));
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(captureMessage).not.toHaveBeenCalled();
  });
});

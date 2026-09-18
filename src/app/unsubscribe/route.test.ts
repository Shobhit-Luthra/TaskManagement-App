import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsert } = vi.hoisted(() => ({ upsert: vi.fn(() => Promise.resolve({ error: null })) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ upsert }) }),
}));

process.env.UNSUBSCRIBE_SECRET = "route-test-secret";

import { generateUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { GET } from "./route";

beforeEach(() => upsert.mockClear());

describe("GET /unsubscribe", () => {
  it("works signed-out and flips exactly the token's category", async () => {
    const token = generateUnsubscribeToken("11111111-1111-1111-1111-111111111111", "digest");
    const res = await GET(new Request(`http://localhost/unsubscribe?t=${token}`) as never);
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      { user_id: "11111111-1111-1111-1111-111111111111", category: "digest", email: false },
      { onConflict: "user_id,category" },
    );
  });

  it("returns a generic message for a missing/invalid token without distinguishing which", async () => {
    const resMissing = await GET(new Request("http://localhost/unsubscribe") as never);
    const resBad = await GET(new Request("http://localhost/unsubscribe?t=garbage") as never);
    const textMissing = await resMissing.text();
    const textBad = await resBad.text();
    expect(resMissing.status).toBe(resBad.status);
    expect(textMissing).toContain("no longer valid");
    expect(textBad).toContain("no longer valid");
    expect(upsert).not.toHaveBeenCalled();
  });
});

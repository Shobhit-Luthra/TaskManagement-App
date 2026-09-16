import { beforeEach, describe, expect, it, vi } from "vitest";
import { withIdempotency } from "./idempotency";

const upsert = vi.fn();
const select = vi.fn();
const from = vi.fn(() => ({ select, upsert }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));

describe("withIdempotency", () => {
  beforeEach(() => {
    upsert.mockReset();
    select.mockReset();
  });

  it("runs and stores the result on first call", async () => {
    select.mockReturnValue({
      eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    });
    upsert.mockResolvedValue({ error: null });
    const run = vi.fn(async () => ({ status: 201, body: { id: "inv-1" } }));
    const result = await withIdempotency({ userId: "u1", key: "k1", requestHash: "h1" }, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 201, body: { id: "inv-1" } });
    expect(upsert).toHaveBeenCalled();
  });

  it("returns the stored response without re-running on replay", async () => {
    select.mockReturnValue({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { request_hash: "h1", status: 201, response: { id: "inv-1" } },
            error: null,
          }),
        }),
      }),
    });
    const run = vi.fn(async () => ({ status: 201, body: { id: "should-not-run" } }));
    const result = await withIdempotency({ userId: "u1", key: "k1", requestHash: "h1" }, run);
    expect(run).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 201, body: { id: "inv-1" } });
  });

  it("re-runs when the same key is replayed with a different request body", async () => {
    select.mockReturnValue({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { request_hash: "different-hash", status: 201, response: {} },
            error: null,
          }),
        }),
      }),
    });
    upsert.mockResolvedValue({ error: null });
    const run = vi.fn(async () => ({ status: 201, body: { id: "new" } }));
    await withIdempotency({ userId: "u1", key: "k1", requestHash: "h1" }, run);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
const update = vi.fn();
const eq1 = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "job_runs") throw new Error(`unexpected table ${table}`);
      return {
        insert: (row: unknown) => {
          insert(row);
          return { select: () => ({ single: () => insertResult }) };
        },
        update: (patch: unknown) => {
          update(patch);
          return { eq: (col: string, value: string) => eq1(col, value) };
        },
      };
    },
  }),
}));

let insertResult: { data: unknown; error: { code: string } | null };

import { claimJobRun, finishJobRun } from "./job-runs";

beforeEach(() => {
  insert.mockReset();
  update.mockReset();
  eq1.mockReset().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
  insertResult = { data: { job_name: "flush" }, error: null };
});

describe("claimJobRun", () => {
  it("claims when no row exists yet", async () => {
    const result = await claimJobRun("flush", "2026-01");
    expect(result).toEqual({ claimed: true });
    expect(insert).toHaveBeenCalledWith({ job_name: "flush", run_key: "2026-01" });
  });

  it("does not claim when the key already exists (unique violation)", async () => {
    insertResult = { data: null, error: { code: "23505" } };
    const result = await claimJobRun("flush", "2026-01");
    expect(result).toEqual({ claimed: false });
  });

  it("rethrows an unexpected database error", async () => {
    insertResult = { data: null, error: { code: "42501" } };
    await expect(claimJobRun("flush", "2026-01")).rejects.toBeTruthy();
  });
});

describe("finishJobRun", () => {
  it("marks the run finished with no error", async () => {
    await finishJobRun("flush", "2026-01");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ error: null }));
  });

  it("records the error message on failure", async () => {
    await finishJobRun("flush", "2026-01", "boom");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ error: "boom" }));
  });
});

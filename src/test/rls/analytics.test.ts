import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let f: IsolationFixture;
beforeAll(async () => {
  f = await seedIsolationFixture();
});
afterAll(async () => {
  await f.cleanup();
});

describe("board_snapshot() (2G.1)", () => {
  it("running twice the same day produces exactly one row per column", async () => {
    const admin = createAdminClient();
    const first = await admin.rpc("board_snapshot");
    expect(first.error).toBeNull();
    const second = await admin.rpc("board_snapshot");
    expect(second.error).toBeNull();

    const { data, error } = await admin
      .from("board_snapshots")
      .select("column_id")
      .eq("project_id", f.projectId)
      .eq("snapshot_date", new Date().toISOString().slice(0, 10));
    expect(error).toBeNull();
    const columnIds = data!.map((row) => row.column_id as string);
    expect(new Set(columnIds).size).toBe(columnIds.length); // no duplicates
    expect(columnIds).toContain(f.columnId);
  });

  it("a non-member cannot read another project's snapshots", async () => {
    const { data, error } = await f.b
      .from("board_snapshots")
      .select("*")
      .eq("project_id", f.projectId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("job_runs records a completed run for today's board_snapshot key", async () => {
    const admin = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await admin
      .from("job_runs")
      .select("finished_at, error")
      .eq("job_name", "board_snapshot")
      .eq("run_key", today)
      .maybeSingle();
    expect(data).not.toBeNull();
    expect(data?.finished_at).not.toBeNull();
    expect(data?.error).toBeNull();
  });
});

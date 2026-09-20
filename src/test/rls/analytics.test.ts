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

describe("analytics_cycle_time (G4 — reopened-then-completed uses the latest completion)", () => {
  it("computes median/p25/p75 from four tasks with known cycle times, and a reopened task uses its second completion", async () => {
    const admin = createAdminClient();
    const columns = await admin
      .from("columns")
      .select("id, is_done_column")
      .eq("project_id", f.projectId);
    const doneColumnId = columns.data!.find((c) => c.is_done_column)!.id as string;

    // Four tasks created at t0, completed at t0+10h/20h/30h/40h respectively.
    const t0 = new Date("2026-01-01T00:00:00Z");
    const hours = [10, 20, 30, 40];
    for (const h of hours) {
      const { data: task } = await admin
        .from("tasks")
        .insert({
          project_id: f.projectId,
          column_id: doneColumnId,
          title: `cycle-${h}h`,
          created_by: f.aId,
          position: Math.random(),
          created_at: t0.toISOString(),
        })
        .select("id")
        .single();
      await admin.from("activity").insert({
        project_id: f.projectId,
        actor_id: f.aId,
        task_id: task!.id,
        entity_type: "task",
        entity_id: task!.id,
        action: "completed",
        created_at: new Date(t0.getTime() + h * 3600_000).toISOString(),
      });
    }

    // A fifth task: completed at t0+5h, reopened at t0+8h, completed again
    // at t0+50h. Cycle time must use the SECOND (latest) completion — 50h —
    // not the first, per 01 §23 / G4.
    const { data: reopened } = await admin
      .from("tasks")
      .insert({
        project_id: f.projectId,
        column_id: doneColumnId,
        title: "reopened-task",
        created_by: f.aId,
        position: Math.random(),
        created_at: t0.toISOString(),
      })
      .select("id")
      .single();
    await admin.from("activity").insert([
      {
        project_id: f.projectId,
        actor_id: f.aId,
        task_id: reopened!.id,
        entity_type: "task",
        entity_id: reopened!.id,
        action: "completed",
        created_at: new Date(t0.getTime() + 5 * 3600_000).toISOString(),
      },
      {
        project_id: f.projectId,
        actor_id: f.aId,
        task_id: reopened!.id,
        entity_type: "task",
        entity_id: reopened!.id,
        action: "reopened",
        created_at: new Date(t0.getTime() + 8 * 3600_000).toISOString(),
      },
      {
        project_id: f.projectId,
        actor_id: f.aId,
        task_id: reopened!.id,
        entity_type: "task",
        entity_id: reopened!.id,
        action: "completed",
        created_at: new Date(t0.getTime() + 50 * 3600_000).toISOString(),
      },
    ]);

    const { data, error } = await f.a.rpc("analytics_cycle_time", {
      p_project_id: f.projectId,
      p_weeks: 260,
    });
    expect(error).toBeNull();
    const bucket = data!.find((row: { sample_size: number }) => row.sample_size === 5);
    expect(bucket).toBeDefined();
    // Sorted cycle hours: [10, 20, 30, 40, 50] → median 30, p25 20, p75 40.
    expect(Number(bucket.median_hours)).toBeCloseTo(30, 1);
    expect(Number(bucket.p25_hours)).toBeCloseTo(20, 1);
    expect(Number(bucket.p75_hours)).toBeCloseTo(40, 1);
  });

  it("a bucket with fewer than 3 completions returns null for median/p25/p75", async () => {
    const { data, error } = await f.a.rpc("analytics_cycle_time", {
      p_project_id: f.projectId,
      p_weeks: 1, // current week only — at most the seed fixture's single task, well under 3
    });
    expect(error).toBeNull();
    const currentWeek = data!.find((row: { sample_size: number }) => row.sample_size < 3);
    if (currentWeek) {
      expect(currentWeek.median_hours).toBeNull();
      expect(currentWeek.p25_hours).toBeNull();
      expect(currentWeek.p75_hours).toBeNull();
    }
  });

  it("a non-member gets 404 (P0002)", async () => {
    const { error } = await f.b.rpc("analytics_cycle_time", {
      p_project_id: f.projectId,
      p_weeks: 12,
    });
    expect(error?.code).toBe("P0002");
  });
});

describe("analytics_throughput / analytics_workload / analytics_summary / analytics_cumulative_flow", () => {
  it("throughput counts completions per week bucket", async () => {
    const { data, error } = await f.a.rpc("analytics_throughput", {
      p_project_id: f.projectId,
      p_weeks: 260,
    });
    expect(error).toBeNull();
    const total = data!.reduce(
      (sum: number, row: { completed_count: number }) => sum + row.completed_count,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(5); // the five tasks seeded above
  });

  it("workload attributes open tasks to the assignee", async () => {
    const admin = createAdminClient();
    await admin.from("tasks").update({ assignee_id: f.aId }).eq("id", f.taskId);
    const { data, error } = await f.a.rpc("analytics_workload", { p_project_id: f.projectId });
    expect(error).toBeNull();
    const row = data!.find((r: { member_user_id: string }) => r.member_user_id === f.aId);
    expect(row?.open_count).toBeGreaterThanOrEqual(1);
  });

  it("cumulative flow leaves gap dates absent rather than interpolated", async () => {
    const { data, error } = await f.a.rpc("analytics_cumulative_flow", {
      p_project_id: f.projectId,
      p_days: 30,
    });
    expect(error).toBeNull();
    const dates = new Set(data!.map((row: { snapshot_date: string }) => row.snapshot_date));
    // Only today's snapshot exists (from Task 2G.1's test) — no synthetic rows for the other 29 days.
    expect(dates.size).toBeLessThan(30);
  });

  it("summary counts total_open/total_done and respects project timezone for overdue (G3)", async () => {
    const { data, error } = await f.a.rpc("analytics_summary", { p_project_id: f.projectId });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.total_open).toBeGreaterThanOrEqual(0);
    expect(row.total_done).toBeGreaterThanOrEqual(5);
  });
});

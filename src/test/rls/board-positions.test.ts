import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let fixture: IsolationFixture;

beforeAll(async () => {
  fixture = await seedIsolationFixture();
});

afterAll(async () => {
  await fixture?.cleanup();
});

describe("move_task position renormalisation", () => {
  it("keeps positions strictly ordered after repeated collisions at the top", async () => {
    const taskIds = [fixture.taskId];
    for (let index = 0; index < 20; index += 1) {
      const { data, error } = await fixture.a.rpc("create_task", {
        p_project_id: fixture.projectId,
        p_column_id: fixture.columnId,
        p_title: `Position ${index}`,
      });
      expect(error).toBeNull();
      const row = Array.isArray(data) ? data[0] : data;
      expect(row?.id).toEqual(expect.any(String));
      taskIds.push(row!.id as string);
    }

    for (const taskId of taskIds) {
      const { error } = await fixture.a.rpc("move_task", {
        p_task_id: taskId,
        p_column_id: fixture.columnId,
        p_position: 0.5,
        p_mutation_id: crypto.randomUUID(),
      });
      expect(error).toBeNull();
    }

    const { data, error } = await fixture.a
      .from("tasks")
      .select("position")
      .eq("column_id", fixture.columnId)
      .is("deleted_at", null)
      .order("position");
    expect(error).toBeNull();
    const positions = (data ?? []).map((row) => row.position as number);
    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index]).toBeGreaterThan(positions[index - 1]!);
      expect(positions[index]! - positions[index - 1]!).toBeGreaterThanOrEqual(1e-6);
    }
  });
});

describe("renormalize_positions", () => {
  it("records a completed, idempotent job run", async () => {
    const runKey = `test-${crypto.randomUUID()}`;
    const { error } = await fixture.a.rpc("run_renormalize_positions_for_test", {
      p_run_key: runKey,
    });
    expect(error).toBeNull();
    const { data: job } = await fixture.a
      .from("job_runs")
      .select("finished_at, error")
      .eq("job_name", "renormalize_positions")
      .eq("run_key", runKey)
      .maybeSingle();
    expect(job?.finished_at).not.toBeNull();
    expect(job?.error).toBeNull();
  });
});

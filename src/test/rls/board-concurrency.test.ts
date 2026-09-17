import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let fixture: IsolationFixture;

beforeAll(async () => {
  fixture = await seedIsolationFixture();
});

afterAll(async () => {
  await fixture?.cleanup();
});

describe("update_task optimistic concurrency", () => {
  it("rejects a stale version without overwriting the current task", async () => {
    const { data: before } = await fixture.a
      .from("tasks")
      .select("updated_at")
      .eq("id", fixture.taskId)
      .single();
    expect(before?.updated_at).toEqual(expect.any(String));
    const first = await fixture.a.rpc("update_task", {
      p_task_id: fixture.taskId,
      p_title: "First edit",
      p_description: null,
      p_due_date: null,
      p_priority: "medium",
      p_assignee_id: null,
      p_expected_updated_at: before!.updated_at,
    });
    expect(first.error).toBeNull();
    const second = await fixture.a.rpc("update_task", {
      p_task_id: fixture.taskId,
      p_title: "Stale edit",
      p_description: null,
      p_due_date: null,
      p_priority: "medium",
      p_assignee_id: null,
      p_expected_updated_at: before!.updated_at,
    });
    expect(second.error?.code).toBe("40001");
    const { data: after } = await fixture.a
      .from("tasks")
      .select("title")
      .eq("id", fixture.taskId)
      .single();
    expect(after?.title).toBe("First edit");
  });
});

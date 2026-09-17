import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let fixture: IsolationFixture;

beforeAll(async () => {
  fixture = await seedIsolationFixture();
});

afterAll(async () => {
  await fixture?.cleanup();
});

describe("update_task assignee validation", () => {
  it("rejects assigning a user who is not a member", async () => {
    const { error } = await fixture.a.rpc("update_task", {
      p_task_id: fixture.taskId,
      p_title: "A task",
      p_description: null,
      p_due_date: null,
      p_priority: "medium",
      p_assignee_id: fixture.bId,
    });
    expect(error?.code).toBe("22023");
  });

  it("accepts a member and records assignment changes", async () => {
    const admin = createAdminClient();
    const inserted = await admin
      .from("memberships")
      .insert({ project_id: fixture.projectId, user_id: fixture.bId, role: "member" });
    expect(inserted.error).toBeNull();
    const assigned = await fixture.a.rpc("update_task", {
      p_task_id: fixture.taskId,
      p_title: "A task",
      p_description: null,
      p_due_date: null,
      p_priority: "medium",
      p_assignee_id: fixture.bId,
    });
    expect(assigned.error).toBeNull();
    const task = Array.isArray(assigned.data) ? assigned.data[0] : assigned.data;
    expect(task?.assignee_id).toBe(fixture.bId);

    const cleared = await fixture.a.rpc("update_task", {
      p_task_id: fixture.taskId,
      p_title: "A task",
      p_description: null,
      p_due_date: null,
      p_priority: "medium",
      p_assignee_id: null,
    });
    expect(cleared.error).toBeNull();
    const { data: activity, error } = await fixture.a
      .from("activity")
      .select("action")
      .eq("task_id", fixture.taskId)
      .in("action", ["assigned", "unassigned"]);
    expect(error).toBeNull();
    expect(activity?.map((row) => row.action)).toEqual(
      expect.arrayContaining(["assigned", "unassigned"]),
    );
  });
});

import { afterAll, beforeAll, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let fixture: IsolationFixture;
beforeAll(async () => {
  fixture = await seedIsolationFixture();
});
afterAll(async () => {
  await fixture?.cleanup();
});

const window = { p_from: "2026-08-31", p_to: "2026-10-11" };

async function setTask(values: Record<string, unknown>) {
  const { error } = await createAdminClient().from("tasks").update(values).eq("id", fixture.taskId);
  expect(error).toBeNull();
}

it("returns dated project tasks with subtask counts and hides them from non-members", async () => {
  await setTask({ due_date: "2026-09-24" });
  const first = await fixture.a.rpc("create_subtask", {
    p_task_id: fixture.taskId,
    p_title: "One",
  });
  expect(first.error).toBeNull();
  const second = await fixture.a.rpc("create_subtask", {
    p_task_id: fixture.taskId,
    p_title: "Two",
  });
  const secondRow = Array.isArray(second.data) ? second.data[0] : second.data;
  await fixture.a.rpc("update_subtask", {
    p_task_id: fixture.taskId,
    p_subtask_id: secondRow.id,
    p_title: null,
    p_is_completed: true,
  });

  const member = await fixture.a.rpc("calendar_tasks", {
    p_project_id: fixture.projectId,
    ...window,
    p_include_undated: false,
  });
  expect(member.error).toBeNull();
  expect(member.data).toEqual([
    expect.objectContaining({
      id: fixture.taskId,
      due_date: "2026-09-24",
      project_name: "Isolation P",
      can_edit: true,
      subtask_done: 1,
      subtask_total: 2,
    }),
  ]);

  const outsider = await fixture.b.rpc("calendar_tasks", {
    p_project_id: fixture.projectId,
    ...window,
    p_include_undated: false,
  });
  expect(outsider.error?.code).toBe("P0002");
});

it("rejects windows longer than 42 days or reversed", async () => {
  const tooLong = await fixture.a.rpc("calendar_tasks", {
    p_project_id: fixture.projectId,
    p_from: "2026-08-31",
    p_to: "2026-10-12",
    p_include_undated: false,
  });
  expect(tooLong.error?.code).toBe("22023");
  const reversed = await fixture.a.rpc("calendar_tasks", {
    p_project_id: fixture.projectId,
    p_from: "2026-10-11",
    p_to: "2026-08-31",
    p_include_undated: false,
  });
  expect(reversed.error?.code).toBe("22023");
});

it("returns undated tasks only when asked", async () => {
  await setTask({ due_date: null });
  const without = await fixture.a.rpc("calendar_tasks", {
    p_project_id: fixture.projectId,
    ...window,
    p_include_undated: false,
  });
  expect(without.data).toEqual([]);
  const withUndated = await fixture.a.rpc("calendar_tasks", {
    p_project_id: fixture.projectId,
    ...window,
    p_include_undated: true,
  });
  expect(withUndated.data).toEqual([
    expect.objectContaining({ id: fixture.taskId, due_date: null }),
  ]);
});

it("scopes the personal calendar to the caller's assigned tasks", async () => {
  await setTask({ due_date: "2026-09-24", assignee_id: null });
  const unassigned = await fixture.a.rpc("calendar_tasks", {
    p_project_id: null,
    ...window,
    p_include_undated: false,
  });
  expect(unassigned.data).toEqual([]);

  await setTask({ assignee_id: fixture.aId });
  const assigned = await fixture.a.rpc("calendar_tasks", {
    p_project_id: null,
    ...window,
    p_include_undated: false,
  });
  expect(assigned.data).toEqual([
    expect.objectContaining({ id: fixture.taskId, project_id: fixture.projectId }),
  ]);
  const outsider = await fixture.b.rpc("calendar_tasks", {
    p_project_id: null,
    ...window,
    p_include_undated: false,
  });
  expect(outsider.error).toBeNull();
  expect(outsider.data).toEqual([]);
});

it("marks tasks read-only for viewers", async () => {
  const admin = createAdminClient();
  const joined = await admin
    .from("memberships")
    .insert({ project_id: fixture.projectId, user_id: fixture.bId, role: "viewer" });
  expect(joined.error).toBeNull();
  const viewer = await fixture.b.rpc("calendar_tasks", {
    p_project_id: fixture.projectId,
    ...window,
    p_include_undated: false,
  });
  expect(viewer.data).toEqual([expect.objectContaining({ id: fixture.taskId, can_edit: false })]);
});

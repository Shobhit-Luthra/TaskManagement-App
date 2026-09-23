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

it("returns the member's tasks and conceals the timeline from non-members", async () => {
  const member = await fixture.a.rpc("project_timeline", { p_project_id: fixture.projectId });
  expect(member.error).toBeNull();
  expect(member.data).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: fixture.taskId, due_date: null })]),
  );
  const outsider = await fixture.b.rpc("project_timeline", { p_project_id: fixture.projectId });
  expect(outsider.error?.code).toBe("P0002");
  expect(outsider.data).toBeNull();
});

it("excludes deleted tasks", async () => {
  const admin = createAdminClient();
  const deleted = await admin
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", fixture.taskId);
  expect(deleted.error).toBeNull();
  const result = await fixture.a.rpc("project_timeline", { p_project_id: fixture.projectId });
  expect(result.error).toBeNull();
  expect(result.data).toEqual([]);
});

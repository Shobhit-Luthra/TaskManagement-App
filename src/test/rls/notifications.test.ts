import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let fixture: IsolationFixture;
beforeAll(async () => {
  fixture = await seedIsolationFixture();
  const result = await createAdminClient()
    .from("memberships")
    .insert({ project_id: fixture.projectId, user_id: fixture.bId, role: "member" });
  if (result.error) throw result.error;
});
afterAll(async () => {
  await fixture?.cleanup();
});

describe("notification authorization and transactional fan-out", () => {
  it("creates an assignment notification readable only by its recipient", async () => {
    const created = await fixture.a.rpc("create_task", {
      p_project_id: fixture.projectId,
      p_column_id: fixture.columnId,
      p_title: "Notify assignee",
      p_assignee_id: fixture.bId,
    });
    expect(created.error).toBeNull();
    const task = Array.isArray(created.data) ? created.data[0] : created.data;
    const own = await fixture.b.from("notifications").select("id, type").eq("task_id", task.id);
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);
    expect(own.data?.[0]?.type).toBe("task_assigned");
    const other = await fixture.a.from("notifications").select("id").eq("task_id", task.id);
    expect(other.data).toEqual([]);
    const queue = await fixture.b.from("notification_queue").select("id");
    expect(queue.data).toEqual([]);
  });

  it("blocks direct notification writes and client fan-out calls", async () => {
    const inserted = await fixture.b
      .from("notifications")
      .insert({ user_id: fixture.bId, project_id: fixture.projectId, type: "mentioned" });
    expect(inserted.error).not.toBeNull();
    const rpc = await fixture.b.rpc("enqueue_notifications", {
      p_type: "mentioned",
      p_project_id: fixture.projectId,
      p_task_id: fixture.taskId,
      p_actor_id: fixture.aId,
      p_recipient_ids: [fixture.bId],
      p_payload: {},
    });
    expect(rpc.error).not.toBeNull();
  });

  it("respects mention email opt-out while retaining the in-app notification", async () => {
    const pref = await fixture.b
      .from("notification_preferences")
      .upsert({ user_id: fixture.bId, category: "mention", email: false });
    expect(pref.error).toBeNull();
    const comment = await fixture.a.rpc("create_comment", {
      p_task_id: fixture.taskId,
      p_body: "Please review",
      p_mentioned_user_ids: [fixture.aId, fixture.bId, fixture.bId],
    });
    expect(comment.error).toBeNull();
    const row = Array.isArray(comment.data) ? comment.data[0] : comment.data;
    const notifications = await createAdminClient()
      .from("notifications")
      .select("user_id, email_status")
      .contains("payload", { commentId: row.id });
    expect(notifications.error).toBeNull();
    expect(notifications.data).toEqual([{ user_id: fixture.bId, email_status: "skipped" }]);
    const denied = await fixture.b
      .from("notification_preferences")
      .upsert({ user_id: fixture.aId, category: "mention", email: false });
    expect(denied.error).not.toBeNull();
  });
});

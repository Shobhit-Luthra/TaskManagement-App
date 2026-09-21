import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let f: IsolationFixture;
beforeAll(async () => {
  f = await seedIsolationFixture();
});
afterAll(async () => {
  await f.cleanup();
});
beforeEach(async () => {
  const admin = createAdminClient();
  await admin.from("memberships").delete().eq("project_id", f.projectId).eq("user_id", f.bId);
  await admin
    .from("memberships")
    .insert({ project_id: f.projectId, user_id: f.bId, role: "member" });
});

describe("delete_own_account (G6)", () => {
  it("refuses a sole Owner and lists the blocking project", async () => {
    const { error } = await f.a.rpc("delete_own_account");
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(error?.details).toContain(f.projectId);
  });

  it("a non-Owner member can delete their account", async () => {
    const { data, error } = await f.b.rpc("delete_own_account");
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.deleted).toBe(true);
    expect(row.tombstone_email).toMatch(/^deleted-[0-9a-f-]{36}@kanbo\.invalid$/);

    const admin = createAdminClient();
    const user = await admin
      .from("users")
      .select("display_name, email, avatar_url, deleted_at")
      .eq("id", f.bId)
      .single();
    expect(user.data?.display_name).toBe("Deleted user");
    expect(user.data?.email).toBe(row.tombstone_email);
    expect(user.data?.avatar_url).toBeNull();
    expect(user.data?.deleted_at).not.toBeNull();
  });

  it("removes the deleted user's membership and unassigns their open tasks", async () => {
    const admin = createAdminClient();
    await admin.from("tasks").update({ assignee_id: f.bId }).eq("id", f.taskId);
    await f.b.rpc("delete_own_account");
    const membership = await admin
      .from("memberships")
      .select("user_id")
      .eq("project_id", f.projectId)
      .eq("user_id", f.bId)
      .maybeSingle();
    expect(membership.data).toBeNull();
    const task = await admin.from("tasks").select("assignee_id").eq("id", f.taskId).single();
    expect(task.data?.assignee_id).toBeNull();
  });

  it("preserves activity.actor_id after the actor's account is deleted", async () => {
    const admin = createAdminClient();
    const created = await f.b.rpc("create_task", {
      p_project_id: f.projectId,
      p_column_id: f.columnId,
      p_title: "B's task before deletion",
    });
    expect(created.error).toBeNull();
    const before = await admin
      .from("activity")
      .select("id")
      .eq("project_id", f.projectId)
      .eq("actor_id", f.bId);
    expect(before.data?.length ?? 0).toBeGreaterThan(0);

    await f.b.rpc("delete_own_account");

    const after = await admin
      .from("activity")
      .select("id, actor_id")
      .in(
        "id",
        (before.data ?? []).map((row) => row.id as string),
      );
    expect(after.data?.length).toBe(before.data?.length);
    expect(after.data?.every((row) => row.actor_id === f.bId)).toBe(true);
  });

  it("once transferred, the former sole Owner can delete their account", async () => {
    await f.a.rpc("transfer_ownership", { p_project_id: f.projectId, p_new_owner_id: f.bId });
    const { data, error } = await f.a.rpc("delete_own_account");
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.deleted).toBe(true);
  });
});

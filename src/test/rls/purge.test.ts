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

describe("purge_soft_deleted() (2G.4)", () => {
  it("hard-deletes only rows past retention, leaves fresh rows and activity untouched", async () => {
    const admin = createAdminClient();
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const fresh = new Date(Date.now() - 1 * 86_400_000).toISOString();

    const { data: oldTask } = await admin
      .from("tasks")
      .insert({
        project_id: f.projectId,
        column_id: f.columnId,
        title: "old-deleted",
        created_by: f.aId,
        position: Math.random(),
        deleted_at: old,
      })
      .select("id")
      .single();
    const { data: freshTask } = await admin
      .from("tasks")
      .insert({
        project_id: f.projectId,
        column_id: f.columnId,
        title: "fresh-deleted",
        created_by: f.aId,
        position: Math.random(),
        deleted_at: fresh,
      })
      .select("id")
      .single();

    await admin.from("idempotency_keys").insert({
      user_id: f.aId,
      key: "old-key",
      request_hash: "h",
      status: 201,
      response: {},
      created_at: new Date(Date.now() - 25 * 3600_000).toISOString(),
    });

    const activityCountBefore = await admin
      .from("activity")
      .select("id", { count: "exact", head: true })
      .eq("project_id", f.projectId);

    const { error } = await admin.rpc("purge_soft_deleted");
    expect(error).toBeNull();

    const oldTaskAfter = await admin.from("tasks").select("id").eq("id", oldTask!.id).maybeSingle();
    expect(oldTaskAfter.data).toBeNull();

    const freshTaskAfter = await admin
      .from("tasks")
      .select("id")
      .eq("id", freshTask!.id)
      .maybeSingle();
    expect(freshTaskAfter.data).not.toBeNull();

    const oldKeyAfter = await admin
      .from("idempotency_keys")
      .select("key")
      .eq("user_id", f.aId)
      .eq("key", "old-key")
      .maybeSingle();
    expect(oldKeyAfter.data).toBeNull();

    const activityCountAfter = await admin
      .from("activity")
      .select("id", { count: "exact", head: true })
      .eq("project_id", f.projectId);
    expect(activityCountAfter.count).toBe(activityCountBefore.count);
  });

  it("is idempotent — running twice in a row does not error", async () => {
    const admin = createAdminClient();
    const first = await admin.rpc("purge_soft_deleted");
    const second = await admin.rpc("purge_soft_deleted");
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
  });
});

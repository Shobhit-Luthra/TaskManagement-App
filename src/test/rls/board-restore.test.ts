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

describe("deleted task read policy and restore_task", () => {
  it("only a project member can read a recently deleted task", async () => {
    expect(
      (await fixture.a.rpc("soft_delete_task", { p_task_id: fixture.taskId })).error,
    ).toBeNull();
    const member = await fixture.a.from("tasks").select("id").eq("id", fixture.taskId);
    const nonMember = await fixture.b.from("tasks").select("id").eq("id", fixture.taskId);
    expect(member.data).toHaveLength(1);
    expect(nonMember.data).toHaveLength(0);
  });

  it("restores within the retention period and writes activity", async () => {
    const restored = await fixture.a.rpc("restore_task", { p_task_id: fixture.taskId });
    expect(restored.error).toBeNull();
    const row = Array.isArray(restored.data) ? restored.data[0] : restored.data;
    expect(row?.id).toBe(fixture.taskId);
    const activity = await fixture.a
      .from("activity")
      .select("action")
      .eq("task_id", fixture.taskId)
      .eq("action", "restored");
    expect(activity.data).toHaveLength(1);
  });

  it("does not disclose a deleted task to a non-member", async () => {
    const admin = createAdminClient();
    await fixture.a.rpc("soft_delete_task", { p_task_id: fixture.taskId });
    await admin
      .from("tasks")
      .update({ deleted_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() })
      .eq("id", fixture.taskId);
    const result = await fixture.b.rpc("restore_task", { p_task_id: fixture.taskId });
    expect(result.error?.code).toBe("P0002");
  });
});

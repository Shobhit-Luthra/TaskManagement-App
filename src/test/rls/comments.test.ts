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

describe("comment authorization and mention resolution", () => {
  it("returns P0002 to a non-member and 42501 to a viewer", async () => {
    const nonMember = await fixture.b.rpc("create_comment", {
      p_task_id: fixture.taskId,
      p_body: "No access",
      p_mentioned_user_ids: [],
    });
    expect(nonMember.error?.code).toBe("P0002");
    await createAdminClient()
      .from("memberships")
      .insert({ project_id: fixture.projectId, user_id: fixture.bId, role: "viewer" });
    const viewer = await fixture.b.rpc("create_comment", {
      p_task_id: fixture.taskId,
      p_body: "No write",
      p_mentioned_user_ids: [],
    });
    expect(viewer.error?.code).toBe("42501");
  });

  it("records the author and drops mention ids outside the current membership", async () => {
    const created = await fixture.a.rpc("create_comment", {
      p_task_id: fixture.taskId,
      p_body: "A comment",
      p_mentioned_user_ids: ["00000000-0000-0000-0000-000000000000"],
    });
    expect(created.error).toBeNull();
    const row = Array.isArray(created.data) ? created.data[0] : created.data;
    expect(row?.author_id).toBe(fixture.aId);
    expect(row?.mentioned_user_ids).toEqual([]);
  });

  it("allows only the author to edit and detects stale writes", async () => {
    const admin = createAdminClient();
    await admin
      .from("memberships")
      .update({ role: "member" })
      .eq("project_id", fixture.projectId)
      .eq("user_id", fixture.bId);
    const created = await fixture.a.rpc("create_comment", {
      p_task_id: fixture.taskId,
      p_body: "Version one",
      p_mentioned_user_ids: [],
    });
    const row = Array.isArray(created.data) ? created.data[0] : created.data;
    const denied = await fixture.b.rpc("update_comment", {
      p_comment_id: row!.id,
      p_body: "Hijack",
      p_mentioned_user_ids: [],
      p_expected_updated_at: row!.updated_at,
    });
    expect(denied.error?.code).toBe("42501");
    const first = await fixture.a.rpc("update_comment", {
      p_comment_id: row!.id,
      p_body: "Version two",
      p_mentioned_user_ids: [],
      p_expected_updated_at: row!.updated_at,
    });
    expect(first.error).toBeNull();
    const stale = await fixture.a.rpc("update_comment", {
      p_comment_id: row!.id,
      p_body: "Stale",
      p_mentioned_user_ids: [],
      p_expected_updated_at: row!.updated_at,
    });
    expect(stale.error?.code).toBe("P0004");
  });
});

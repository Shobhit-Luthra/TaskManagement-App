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

describe("project labels", () => {
  it("hides labels from non-members and rejects label management", async () => {
    const created = await fixture.a.rpc("create_label", {
      p_project_id: fixture.projectId,
      p_name: "Bug",
      p_color: "#EF4444",
    });
    expect(created.error).toBeNull();
    const label = Array.isArray(created.data) ? created.data[0] : created.data;
    const read = await fixture.b.from("labels").select("id").eq("project_id", fixture.projectId);
    expect(read.data).toEqual([]);
    const denied = await fixture.b.rpc("update_label", {
      p_label_id: label.id,
      p_name: "Other",
      p_color: "#111111",
    });
    expect(denied.error?.code).toBe("P0002");
  });

  it("allows members to attach only labels from their project", async () => {
    const admin = createAdminClient();
    await admin
      .from("memberships")
      .insert({ project_id: fixture.projectId, user_id: fixture.bId, role: "member" });
    const created = await fixture.a.rpc("create_label", {
      p_project_id: fixture.projectId,
      p_name: "Feature",
      p_color: "#4F46E5",
    });
    const label = Array.isArray(created.data) ? created.data[0] : created.data;
    const attached = await fixture.b.rpc("set_task_labels", {
      p_task_id: fixture.taskId,
      p_label_ids: [label.id],
    });
    expect(attached.error).toBeNull();
    const assigned = await fixture.b
      .from("task_labels")
      .select("label_id")
      .eq("task_id", fixture.taskId);
    expect(assigned.data).toEqual([{ label_id: label.id }]);
  });

  it("limits creation and deletion to owners and admins", async () => {
    const admin = createAdminClient();
    await admin
      .from("memberships")
      .upsert(
        { project_id: fixture.projectId, user_id: fixture.bId, role: "member" },
        { onConflict: "project_id,user_id" },
      );
    const denied = await fixture.b.rpc("create_label", {
      p_project_id: fixture.projectId,
      p_name: "Nope",
      p_color: "#111111",
    });
    expect(denied.error?.code).toBe("42501");
  });
});

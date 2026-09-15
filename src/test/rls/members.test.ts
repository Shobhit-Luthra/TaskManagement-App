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

describe("project_peers view (T5)", () => {
  it("a non-member of P sees nothing for A", async () => {
    const { data, error } = await f.b.from("project_peers").select("*").eq("id", f.aId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a fellow member sees display_name and avatar_url but not email", async () => {
    const admin = createAdminClient();
    await admin
      .from("memberships")
      .insert({ project_id: f.projectId, user_id: f.bId, role: "member" });
    try {
      const { data, error } = await f.b.from("project_peers").select("*").eq("id", f.aId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]).toMatchObject({ id: f.aId, display_name: "RLS a" });
      expect(data?.[0]).not.toHaveProperty("email");
    } finally {
      // Restore b as a non-member so the "project-scoped 404" describe block
      // below still observes b as an outsider to P (fixture is shared across
      // this file's describe blocks via a single beforeAll).
      await admin.from("memberships").delete().eq("project_id", f.projectId).eq("user_id", f.bId);
    }
  });
});

describe("project-scoped 404 for non-members (07 §18.12)", () => {
  it("move_task raises P0002, not 42501, for a non-member", async () => {
    const { error } = await f.b.rpc("move_task", {
      p_task_id: f.taskId,
      p_column_id: f.columnId,
      p_position: 0.5,
      p_mutation_id: crypto.randomUUID(),
    });
    expect(error?.code).toBe("P0002");
  });

  it("update_project raises P0002 for a non-member", async () => {
    const { error } = await f.b.rpc("update_project", {
      p_project_id: f.projectId,
      p_name: "hijack",
      p_description: null,
      p_timezone: "UTC",
    });
    expect(error?.code).toBe("P0002");
  });
});

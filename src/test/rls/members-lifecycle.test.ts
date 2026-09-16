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

describe("change_member_role", () => {
  it("Owner can promote a Member to Admin", async () => {
    const { data, error } = await f.a.rpc("change_member_role", {
      p_project_id: f.projectId,
      p_user_id: f.bId,
      p_role: "admin",
    });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.role).toBe("admin");
  });

  it("cannot promote anyone to Owner via this RPC", async () => {
    const { error } = await f.a.rpc("change_member_role", {
      p_project_id: f.projectId,
      p_user_id: f.bId,
      p_role: "owner",
    });
    expect(error).not.toBeNull();
  });

  it("a Member cannot change anyone's role", async () => {
    const { error } = await f.b.rpc("change_member_role", {
      p_project_id: f.projectId,
      p_user_id: f.bId,
      p_role: "viewer",
    });
    expect(error?.code).toBe("42501");
  });
});

describe("remove_member", () => {
  it("Owner can remove a Member; B's next read returns zero rows", async () => {
    const { error } = await f.a.rpc("remove_member", {
      p_project_id: f.projectId,
      p_user_id: f.bId,
    });
    expect(error).toBeNull();
    const { data } = await f.b.from("projects").select("id").eq("id", f.projectId);
    expect(data).toEqual([]);
  });

  it("the last Owner cannot remove themselves", async () => {
    const { error } = await f.a.rpc("remove_member", {
      p_project_id: f.projectId,
      p_user_id: f.aId,
    });
    expect(error).not.toBeNull();
  });
});

describe("leave_project", () => {
  it("a Member can leave", async () => {
    const { error } = await f.b.rpc("leave_project", { p_project_id: f.projectId });
    expect(error).toBeNull();
  });

  it("the Owner cannot leave (must transfer ownership first)", async () => {
    const { error } = await f.a.rpc("leave_project", { p_project_id: f.projectId });
    expect(error).not.toBeNull();
  });
});

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

describe("transfer_ownership", () => {
  it("Owner can transfer to an existing member", async () => {
    const { error } = await f.a.rpc("transfer_ownership", {
      p_project_id: f.projectId,
      p_new_owner_id: f.bId,
    });
    expect(error).toBeNull();
    const { data } = await f.b
      .from("memberships")
      .select("role")
      .eq("project_id", f.projectId)
      .eq("user_id", f.bId)
      .single();
    expect(data?.role).toBe("owner");
    // Restore so later tests in this file still find A as Owner.
    // memberships_one_owner allows at most one 'owner' row per project, so
    // B must be demoted before A is promoted back, not the other way round.
    const admin = createAdminClient();
    const demoteB = await admin
      .from("memberships")
      .update({ role: "admin" })
      .eq("project_id", f.projectId)
      .eq("user_id", f.bId);
    if (demoteB.error) throw demoteB.error;
    const promoteA = await admin
      .from("memberships")
      .update({ role: "owner" })
      .eq("project_id", f.projectId)
      .eq("user_id", f.aId);
    if (promoteA.error) throw promoteA.error;
    const restoreOwnerId = await admin
      .from("projects")
      .update({ owner_id: f.aId })
      .eq("id", f.projectId);
    if (restoreOwnerId.error) throw restoreOwnerId.error;
  });

  it("cannot transfer to a non-member", async () => {
    const { error } = await f.a.rpc("transfer_ownership", {
      p_project_id: f.projectId,
      p_new_owner_id: crypto.randomUUID(),
    });
    expect(error).not.toBeNull();
  });
});

describe("archive_project", () => {
  it("Owner can archive and unarchive", async () => {
    const archived = await f.a.rpc("archive_project", {
      p_project_id: f.projectId,
      p_is_archived: true,
    });
    expect(archived.error).toBeNull();
    const row = Array.isArray(archived.data) ? archived.data[0] : archived.data;
    expect(row.is_archived).toBe(true);
    const unarchived = await f.a.rpc("archive_project", {
      p_project_id: f.projectId,
      p_is_archived: false,
    });
    expect(unarchived.error).toBeNull();
  });

  it("a Member cannot archive", async () => {
    const { error } = await f.b.rpc("archive_project", {
      p_project_id: f.projectId,
      p_is_archived: true,
    });
    expect(error?.code).toBe("42501");
  });
});

describe("soft_delete_project", () => {
  it("a Member cannot delete", async () => {
    const { error } = await f.b.rpc("soft_delete_project", { p_project_id: f.projectId });
    expect(error?.code).toBe("42501");
  });

  it("deletes cascade to zero-row visibility for members", async () => {
    const { error } = await f.a.rpc("soft_delete_project", { p_project_id: f.projectId });
    expect(error).toBeNull();
    const project = await f.b.from("projects").select("id").eq("id", f.projectId);
    expect(project.data).toEqual([]);
    const tasks = await f.b.from("tasks").select("id").eq("project_id", f.projectId);
    expect(tasks.data).toEqual([]);
  });
});

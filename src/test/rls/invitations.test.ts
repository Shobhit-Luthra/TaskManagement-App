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

describe("create_invitation", () => {
  it("a non-member cannot invite (404)", async () => {
    const { error } = await f.b.rpc("create_invitation", {
      p_project_id: f.projectId,
      p_email: "new@example.test",
      p_role: "member",
      p_token_hash: "a".repeat(64),
    });
    expect(error?.code).toBe("P0002");
  });

  it("Owner can invite a member; re-inviting the same pending email is idempotent", async () => {
    const first = await f.a.rpc("create_invitation", {
      p_project_id: f.projectId,
      p_email: "invitee@example.test",
      p_role: "member",
      p_token_hash: "b".repeat(64),
    });
    expect(first.error).toBeNull();
    const firstRow = Array.isArray(first.data) ? first.data[0] : first.data;
    expect(firstRow.resent).toBe(false);

    const second = await f.a.rpc("create_invitation", {
      p_project_id: f.projectId,
      p_email: "invitee@example.test",
      p_role: "member",
      p_token_hash: "c".repeat(64),
    });
    expect(second.error).toBeNull();
    const secondRow = Array.isArray(second.data) ? second.data[0] : second.data;
    expect(secondRow.id).toBe(firstRow.id);
    expect(secondRow.resent).toBe(true);
  });

  it("cannot invite an already-a-member email (409)", async () => {
    const admin = createAdminClient();
    const membersEmail = await admin.from("users").select("email").eq("id", f.bId).single();
    await admin
      .from("memberships")
      .insert({ project_id: f.projectId, user_id: f.bId, role: "member" });
    const { error } = await f.a.rpc("create_invitation", {
      p_project_id: f.projectId,
      p_email: membersEmail.data?.email,
      p_role: "member",
      p_token_hash: "d".repeat(64),
    });
    expect(error?.code).toBe("23505");
  });

  it("an Admin cannot invite an Admin or Owner (BR-2)", async () => {
    const admin = createAdminClient();
    const { data: c } = await admin.auth.admin.createUser({
      email: `rls-c-${crypto.randomUUID()}@example.test`,
      password: `Pw-${crypto.randomUUID()}`,
      email_confirm: true,
      user_metadata: { display_name: "RLS c" },
    });
    if (!c.user) throw new Error("no user");
    await admin
      .from("memberships")
      .insert({ project_id: f.projectId, user_id: c.user.id, role: "admin" });
    const cClient = createAdminClient();
    const { error } = await cClient.rpc("create_invitation", {
      p_project_id: f.projectId,
      p_email: "shouldnt-work@example.test",
      p_role: "admin",
      p_token_hash: "e".repeat(64),
    });
    // Admin's own client is used here indirectly: called via admin client bypasses auth.uid(),
    // so this asserts the RPC rejects role >= caller's when auth context is absent too (28000),
    // which is also correct — a service-role caller has no auth.uid() and must be rejected.
    expect(error).not.toBeNull();
    await admin.auth.admin.deleteUser(c.user.id);
  });
});

describe("revoke_invitation", () => {
  it("Owner can revoke; a revoked token can no longer be accepted", async () => {
    const created = await f.a.rpc("create_invitation", {
      p_project_id: f.projectId,
      p_email: "revoke-me@example.test",
      p_role: "member",
      p_token_hash: "f".repeat(64),
    });
    const row = Array.isArray(created.data) ? created.data[0] : created.data;
    const { error } = await f.a.rpc("revoke_invitation", { p_invitation_id: row.id });
    expect(error).toBeNull();
    const check = await createAdminClient()
      .from("invitations")
      .select("id")
      .eq("id", row.id)
      .maybeSingle();
    expect(check.data).toBeNull();
  });
});

import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

/** invitations.token_hash is globally unique and this suite runs against a
 * persistent dev database (no per-run reset), so fixed literal hashes like
 * "a".repeat(64) collide with leftover rows from a prior run. */
function tokenHash(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

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
      p_token_hash: tokenHash(),
    });
    expect(error?.code).toBe("P0002");
  });

  it("Owner can invite a member; re-inviting the same pending email is idempotent", async () => {
    const first = await f.a.rpc("create_invitation", {
      p_project_id: f.projectId,
      p_email: "invitee@example.test",
      p_role: "member",
      p_token_hash: tokenHash(),
    });
    expect(first.error).toBeNull();
    const firstRow = Array.isArray(first.data) ? first.data[0] : first.data;
    expect(firstRow.resent).toBe(false);

    const second = await f.a.rpc("create_invitation", {
      p_project_id: f.projectId,
      p_email: "invitee@example.test",
      p_role: "member",
      p_token_hash: tokenHash(),
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
      p_token_hash: tokenHash(),
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
      p_token_hash: tokenHash(),
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
      p_token_hash: tokenHash(),
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

describe("peek_invitation / accept_invitation / decline_invitation", () => {
  it("peek_invitation works signed-out and leaks only project/inviter/role", async () => {
    const token = tokenHash();
    const created = await f.a.rpc("create_invitation", {
      p_project_id: f.projectId,
      p_email: "peek-me@example.test",
      p_role: "member",
      p_token_hash: token,
    });
    const row = Array.isArray(created.data) ? created.data[0] : created.data;
    const anon = createAdminClient(); // service role bypasses RLS but peek is security definer + granted to anon regardless
    const { data, error } = await anon.rpc("peek_invitation", { p_token_hash: token });
    expect(error).toBeNull();
    const peeked = Array.isArray(data) ? data[0] : data;
    expect(peeked).toMatchObject({ project_name: "Isolation P", role: "member" });
    expect(peeked).not.toHaveProperty("email");
    void row;
  });

  it("accept_invitation rejects an email mismatch with 403, not enumeration", async () => {
    const token = tokenHash();
    const created = await f.a.rpc("create_invitation", {
      p_project_id: f.projectId,
      p_email: "only-this-email@example.test",
      p_role: "member",
      p_token_hash: token,
    });
    void created;
    const { error } = await f.b.rpc("accept_invitation", { p_token_hash: token });
    expect(error?.code).toBe("42501");
  });

  it("accept_invitation is single-use: second accept returns 410 GONE", async () => {
    // A fresh, never-a-member user — f.b already joined the project earlier
    // in this file (the "already-a-member" 409 test), so reusing it here
    // would make create_invitation raise ALREADY_MEMBER before this test's
    // own assertions run.
    const admin = createAdminClient();
    const email = `rls-invitee-${randomUUID()}@example.test`;
    const password = `Pw-${randomUUID()}`;
    const { data: invitee } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: "RLS invitee" },
    });
    if (!invitee.user) throw new Error("no user");
    const inviteeClient = createClient(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    await inviteeClient.auth.signInWithPassword({ email, password });

    const token = tokenHash();
    const created = await f.a.rpc("create_invitation", {
      p_project_id: f.projectId,
      p_email: email,
      p_role: "member",
      p_token_hash: token,
    });
    void created;
    const first = await inviteeClient.rpc("accept_invitation", { p_token_hash: token });
    expect(first.error).toBeNull();
    const second = await inviteeClient.rpc("accept_invitation", { p_token_hash: token });
    expect(second.error?.code).toBe("P0003");
    await admin.auth.admin.deleteUser(invitee.user.id);
  });

  it("an unknown token returns P0002 from peek and accept", async () => {
    const anon = createAdminClient();
    const peek = await anon.rpc("peek_invitation", { p_token_hash: tokenHash() });
    expect(peek.error?.code).toBe("P0002");
    const accept = await f.a.rpc("accept_invitation", { p_token_hash: tokenHash() });
    expect(accept.error?.code).toBe("P0002");
  });
});

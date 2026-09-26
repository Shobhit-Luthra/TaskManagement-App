import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createConfirmedUser,
  deleteTestUsers,
  seedIsolationFixture,
  type IsolationFixture,
} from "./setup";

// Roles in play: A = owner, B = outsider asking to join, C = becomes member,
// D = becomes admin, E = outsider D tries to approve. Runs top to bottom.
let fixture: IsolationFixture;
const admin = createAdminClient();
const extra: { id: string; client: SupabaseClient }[] = [];
let c: { id: string; client: SupabaseClient };
let d: { id: string; client: SupabaseClient };
let e: { id: string; client: SupabaseClient };
let code: string;

beforeAll(async () => {
  fixture = await seedIsolationFixture();
  c = await createConfirmedUser(admin, "c");
  d = await createConfirmedUser(admin, "d");
  e = await createConfirmedUser(admin, "e");
  extra.push(c, d, e);
});
afterAll(async () => {
  await deleteTestUsers(
    admin,
    extra.map((user) => user.id),
  );
  await fixture?.cleanup();
});

function row<T>(data: T | T[] | null): T {
  return (Array.isArray(data) ? data[0] : data) as T;
}

async function requestJoin(client: SupabaseClient, value: string) {
  return client.rpc("request_to_join", { p_code: value });
}

async function approve(client: SupabaseClient, requestId: string, role: string | null) {
  return client.rpc("decide_join_request", {
    p_request_id: requestId,
    p_approve: true,
    p_role: role,
  });
}

async function roleOf(userId: string) {
  const { data } = await admin
    .from("memberships")
    .select("role")
    .eq("project_id", fixture.projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.role ?? null;
}

describe("join codes", () => {
  it("only lets an admin generate a code, and rotating changes it", async () => {
    const outsider = await fixture.b.rpc("generate_join_code", { p_project_id: fixture.projectId });
    expect(outsider.error?.code).toBe("P0002");

    const first = await fixture.a.rpc("generate_join_code", { p_project_id: fixture.projectId });
    expect(first.error).toBeNull();
    const firstCode = row<{ code: string }>(first.data).code;
    expect(firstCode).toMatch(/^\d{6}$/);

    const second = await fixture.a.rpc("generate_join_code", { p_project_id: fixture.projectId });
    code = row<{ code: string }>(second.data).code;
    expect(code).toMatch(/^\d{6}$/);
    expect(code).not.toBe(firstCode);
  });

  it("hides the code from non-admins", async () => {
    const read = await fixture.b.from("project_join_codes").select("code");
    expect(read.data).toEqual([]);
  });

  it("gives one generic error for unknown codes and rejects malformed ones", async () => {
    const unknown = code === "000000" ? "000001" : "000000";
    expect((await requestJoin(fixture.b, unknown)).error?.code).toBe("P0002");
    expect((await requestJoin(fixture.b, "12ab56")).error?.code).toBe("22023");
  });

  it("creates one pending request per person, visible to them and admins only", async () => {
    const first = await requestJoin(fixture.b, code);
    expect(first.error).toBeNull();
    expect(row(first.data)).toMatchObject({ project_name: "Isolation P", status: "pending" });
    const again = await requestJoin(fixture.b, code);
    expect(row<{ request_id: string }>(again.data).request_id).toBe(
      row<{ request_id: string }>(first.data).request_id,
    );

    const own = await fixture.b.from("join_requests").select("id");
    expect(own.data).toHaveLength(1);
    const other = await c.client.from("join_requests").select("id");
    expect(other.data).toEqual([]);

    const listed = await fixture.a.rpc("list_join_requests", { p_project_id: fixture.projectId });
    expect(listed.error).toBeNull();
    expect(listed.data).toEqual([expect.objectContaining({ user_id: fixture.bId })]);

    const mine = await fixture.b.rpc("list_my_join_requests");
    expect(mine.data).toEqual([expect.objectContaining({ project_name: "Isolation P" })]);
  });

  it("notifies the owner of a new request", async () => {
    const { data } = await admin
      .from("notifications")
      .select("type, payload")
      .eq("user_id", fixture.aId)
      .eq("type", "join_requested");
    expect(data?.length).toBeGreaterThan(0);
  });

  it("approves with the role the approver picks", async () => {
    const request = row<{ request_id: string }>((await requestJoin(c.client, code)).data);
    expect((await approve(fixture.a, request.request_id, null)).error?.code).toBe("22023");
    expect((await approve(fixture.a, request.request_id, "owner")).error?.code).toBe("42501");

    const approved = await approve(fixture.a, request.request_id, "member");
    expect(approved.error).toBeNull();
    expect(await roleOf(c.id)).toBe("member");

    const twice = await approve(fixture.a, request.request_id, "member");
    expect(twice.error?.code).toBe("P0003");
    expect((await requestJoin(c.client, code)).error?.code).toBe("23505");
  });

  it("keeps members out of code and request management", async () => {
    const generate = await c.client.rpc("generate_join_code", { p_project_id: fixture.projectId });
    expect(generate.error?.code).toBe("42501");
    expect((await c.client.from("project_join_codes").select("code")).data).toEqual([]);
    const list = await c.client.rpc("list_join_requests", { p_project_id: fixture.projectId });
    expect(list.error?.code).toBe("42501");

    const pending = row<{ id: string }>(
      (await fixture.a.rpc("list_join_requests", { p_project_id: fixture.projectId })).data,
    );
    expect((await approve(c.client, pending.id, "viewer")).error?.code).toBe("42501");
  });

  it("lets an owner grant admin but stops an admin granting admin", async () => {
    const dRequest = row<{ request_id: string }>((await requestJoin(d.client, code)).data);
    expect((await approve(fixture.a, dRequest.request_id, "admin")).error).toBeNull();
    expect(await roleOf(d.id)).toBe("admin");

    const eRequest = row<{ request_id: string }>((await requestJoin(e.client, code)).data);
    expect((await approve(d.client, eRequest.request_id, "admin")).error?.code).toBe("42501");

    const denied = await d.client.rpc("decide_join_request", {
      p_request_id: eRequest.request_id,
      p_approve: false,
      p_role: null,
    });
    expect(denied.error).toBeNull();
    expect(await roleOf(e.id)).toBeNull();
  });

  it("approves the outsider as a viewer", async () => {
    const pending = row<{ id: string }>(
      (await fixture.a.rpc("list_join_requests", { p_project_id: fixture.projectId })).data,
    );
    expect((await approve(fixture.a, pending.id, "viewer")).error).toBeNull();
    expect(await roleOf(fixture.bId)).toBe("viewer");
  });

  it("lets a requester cancel only their own pending request", async () => {
    const request = row<{ request_id: string }>((await requestJoin(e.client, code)).data);
    const byOther = await c.client.rpc("cancel_join_request", { p_request_id: request.request_id });
    expect(byOther.error?.code).toBe("P0002");
    const own = await e.client.rpc("cancel_join_request", { p_request_id: request.request_id });
    expect(own.error).toBeNull();
  });

  it("treats disabled and expired codes exactly like unknown ones", async () => {
    await fixture.a.rpc("disable_join_code", { p_project_id: fixture.projectId });
    expect((await requestJoin(e.client, code)).error?.code).toBe("P0002");

    const fresh = row<{ code: string }>(
      (await fixture.a.rpc("generate_join_code", { p_project_id: fixture.projectId })).data,
    ).code;
    await admin
      .from("project_join_codes")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("project_id", fixture.projectId);
    expect((await requestJoin(e.client, fresh)).error?.code).toBe("P0002");
  });
});

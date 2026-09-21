# Kanbo Sub-plan 2G (part 2 of 2) — Account deletion, CSP nonce, production launch

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This file covers **Task 2G.5 through Task 2G.7** — the last three tasks of the last sub-plan. Task 2G.1 through Task 2G.4 (snapshots, analytics SQL/UI, purge job) are in `2G-analytics-hardening-1.md`; complete that file first — Task 2G.5 reuses `job_runs`/purge conventions it establishes, and the purge job must exist before production launch (Task 2G.7) verifies the backup/keep-alive story around it.

**Goal:** Account deletion (G6) with the same Owner-guard / soft-delete-cascade shape as `2B-members-invitations.md` Task 2B.6, the CSP nonce (T6) that finally removes `'unsafe-inline'` from script-src, a full walk of the `07 §18` security acceptance checklist, and the production launch itself — the point at which Kanbo is the MVP defined in `01 §14`.

**Architecture:** Same conventions as every prior sub-plan. `delete_own_account()` is the user-level mirror of Task 2B.6's `soft_delete_project()`: same Owner-guard pattern (a user cannot self-delete while they are the sole Owner of any project — the mirror of "the Owner cannot leave without transferring first"), same "cascade what must disappear, leave what must remain queryable" shape (memberships/unassignment cascade like `remove_member`; the `users` row itself is anonymised in place rather than deleted outright, because `activity.actor_id` and `tasks.created_by` reference it with `on delete restrict`/`on delete set null` and the audit trail must survive — `04 §4.10`).

**Tech Stack:** Next.js 16.3 Route Handlers + Server Actions, TypeScript strict, Zod 3, `@supabase/ssr`/`@supabase/supabase-js`, Postgres `security definer` functions, Vitest 5 + Testing Library.

**Spec:** `00-master-roadmap.md` §2 Gap Register (rows **G6**, **T6**, **T17**), §4 cross-cutting rules, §5 Sub-plan 2G, §6 Verification, §7 Out of scope; `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md`; `docs/specs/00`–`07` (`07 §18` is the 12-item security acceptance checklist Task 2G.6 walks item-by-item — read it before writing `docs/security-acceptance.md`, since this plan references it by item number but the item text itself lives only in that spec file).

## Global Constraints

- **The ambiguous-column bug (do not reintroduce it):** any `security definer` plpgsql function that declares `returns table (id uuid, ...)` (or any OUT-parameter name that also happens to be a table column — `position`, `role`, `email`, etc.) creates a variable of that name in scope for the whole function body, and an unqualified reference to it inside the body is ambiguous between the OUT parameter and the column — this broke `create_task`/`move_task`/`update_task` and others in this repo until `202609150001_fix_ambiguous_id_refs.sql`/`202609150002_fix_ambiguous_position_ref.sql`. `delete_own_account()` below returns `table (deleted boolean, blocked_projects jsonb)` — no `id`/`role`/`email` OUT parameter — but every reference to `public.users`, `public.memberships`, `public.projects` columns inside its body is still qualified with a table alias, on the same "never rely on today's OUT-parameter names staying collision-free" discipline used throughout this plan. Unit tests cannot catch this; only `npm run test:rls` against a real Supabase project does.
- TypeScript strict; no `any` in application code.
- No Docker locally. Apply migrations via `npm run db:push` (or Supabase MCP `apply_migration` against `kanbo-dev`), then run `npm run test:rls` to prove it.
- Every migration file: `supabase/migrations/YYYYMMDDNNNN_<name>.sql`, forward-only.
- Every new/changed RPC: `security definer`, `set search_path = public`, `revoke all … from public`, explicit `grant execute` to the minimum role.
- Every project-scoped write: non-members get **404**, never 403.
- Security-sensitive tasks (account deletion, CSP) list security properties and have one test per property: no enumeration, explicit max lengths before any string reaches crypto/hashing, generic error copy, and — specific to this file — a session that must actually be invalidated after deletion, and an audit trail (`activity.actor_id`) that must survive the very deletion it recorded.
- `SUPABASE_SERVICE_ROLE_KEY` only via `createAdminClient()` — never inline. `DELETE /api/v1/users/me` uses it to end the caller's own Supabase Auth session (`admin.auth.admin.signOut`) after the RPC succeeds — the one legitimate case in this plan of the service-role client acting on behalf of the calling user's own account, never anyone else's.
- Structured JSON logs via `log()`; never log tokens, emails, or comment bodies.
- Commit at the end of every task: Conventional Commits, **no `Co-Authored-By` or `Claude-Session` trailers** (`ENGINEERING_RULES.md §7`). Before each commit: `git status`, inspect the diff, no secrets, `npm run test`, `npm run typecheck`, `npm run lint`.
- T6 (CSP nonce): the nonce is generated once per request in `middleware.ts`, forwarded to Next via the `x-nonce` request header (Next's built-in nonce propagation reads this and threads it onto every script tag it renders), and echoed onto the response's `Content-Security-Policy` header — `script-src 'self' 'nonce-<value>'` in production, with `'unsafe-inline'` removed. `next.config.ts`'s `headers()` keeps every other static header (HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, the non-script CSP directives) exactly as-is; only `script-src` generation moves to middleware because it's the only directive that needs a value computed per-request.

---

## File Structure

```
supabase/migrations/202609200001_account_deletion.sql       Task 2G.5
src/app/api/v1/users/me/route.ts                              Task 2G.5
src/components/settings/danger-zone.tsx                        Task 2G.5
src/components/settings/danger-zone.test.tsx                    Task 2G.5
src/test/rls/account-deletion.test.ts                            Task 2G.5
src/lib/security/csp.ts                                          Task 2G.6
src/lib/security/csp.test.ts                                      Task 2G.6
middleware.ts                                                      Task 2G.6 (modify)
src/lib/security/headers.ts                                        Task 2G.6 (modify — drop script-src)
next.config.ts                                                     Task 2G.6 (modify — headers() no longer sets CSP)
docs/security-acceptance.md                                        Task 2G.6
docs/runbook.md                                                     Task 2G.7 (modify)
README.md                                                          Task 2G.7 (modify)
```

---

### Task 2G.5 — Account deletion (G6)

> **Progress note (2026-09-21): shipped in `cbe1f54`.** Deviations from the steps below, all deliberate:
> - Migration is `202609260001_account_deletion.sql` (the planned `202609200001_` would sort before the already-applied 2G.1–2G.4 migrations).
> - RPC returns `(deleted boolean, tombstone_email text)` — `blocked_projects` is only ever raised as the exception `DETAIL`, never returned as a row, and the route needs the tombstone to sync `auth.users`. It also clears the user's `notifications`, `notification_queue`, `notification_preferences` and `idempotency_keys` rows.
> - Route reads PostgREST's `error.details` (not `.detail`), and — because anonymising `public.users` alone leaves the credentials in `auth.users` working — also calls `auth.admin.updateUserById` (tombstone email + permanent ban) before `auth.admin.signOut(<jwt>, "global")` (which takes a JWT, not a user id). Verified end-to-end against `kanbo-dev`: old password rejected, old cookie → 401, original email reusable.
> - No account settings page existed from 2F.5 (only the preferences API route shipped), so a minimal `src/app/(app)/account/page.tsx` was added and the header email now links to it.

**Files:**
- Create: `supabase/migrations/202609200001_account_deletion.sql`, `src/app/api/v1/users/me/route.ts`, `src/components/settings/danger-zone.tsx`, `src/components/settings/danger-zone.test.tsx`, `src/test/rls/account-deletion.test.ts`

**Interfaces:**
- Produces RPC `delete_own_account() returns table (deleted boolean, blocked_projects jsonb)` — on success `deleted = true`, `blocked_projects = null`; when the caller is the sole Owner of one or more projects, raises `ACCOUNT_DELETE_BLOCKED` (`errcode '42501'`) rather than returning a row, so the route can surface exactly which projects need to be transferred or deleted first (client fetches project names separately from the error payload's `blocked_projects` detail — see Step 3).
- Consumes: `DELETE /api/v1/users/me`, `createAdminClient` (session invalidation).

**Security properties:** mirrors Task 2B.6's `soft_delete_project` Owner-guard exactly, at the user level: a user who is the sole Owner of any project (per `memberships` where `role = 'owner'` and no other Owner row exists for that `project_id` — the same query shape the `memberships_one_owner` unique index encodes) cannot delete their account until they transfer ownership or delete the project first; anonymisation replaces `display_name` with `"Deleted user"` and `email` with a per-row-unique tombstone (`deleted-<uuid>@kanbo.invalid` — the `citext unique` constraint on `users.email` means two anonymised rows cannot collide, and the value can never be a real deliverable address); `activity.actor_id` is preserved (the FK is `on delete set null`, but this RPC never deletes the `users` row, only anonymises it in place, so `actor_id` keeps pointing at a real — if anonymised — row and old activity entries still resolve to "Deleted user" instead of silently losing their actor); the caller's session is invalidated by the route handler immediately after a successful RPC call, before the response is returned, so a stolen bearer token from the same request cannot be replayed against any other endpoint.

- [x] **Step 1: Failing RLS test**

```ts
// src/test/rls/account-deletion.test.ts
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
  await admin.from("memberships").insert({ project_id: f.projectId, user_id: f.bId, role: "member" });
});

describe("delete_own_account (G6)", () => {
  it("refuses a sole Owner and lists the blocking project", async () => {
    const { error } = await f.a.rpc("delete_own_account");
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("a non-Owner member can delete their account", async () => {
    const { data, error } = await f.b.rpc("delete_own_account");
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.deleted).toBe(true);

    const admin = createAdminClient();
    const user = await admin.from("users").select("display_name, email").eq("id", f.bId).single();
    expect(user.data?.display_name).toBe("Deleted user");
    expect(user.data?.email).toMatch(/^deleted-[0-9a-f-]{36}@kanbo\.invalid$/);
  });

  it("removes the deleted user's membership and unassigns their open tasks", async () => {
    const admin = createAdminClient();
    await admin.from("tasks").update({ assignee_id: f.bId }).eq("id", f.taskId);
    await f.b.rpc("delete_own_account");
    const membership = await admin.from("memberships").select("user_id").eq("project_id", f.projectId).eq("user_id", f.bId).maybeSingle();
    expect(membership.data).toBeNull();
    const task = await admin.from("tasks").select("assignee_id").eq("id", f.taskId).single();
    expect(task.data?.assignee_id).toBeNull();
  });

  it("preserves activity.actor_id after the actor's account is deleted", async () => {
    const admin = createAdminClient();
    const before = await admin.from("activity").select("id").eq("project_id", f.projectId).eq("actor_id", f.bId);
    await f.b.rpc("delete_own_account");
    const after = await admin.from("activity").select("id, actor_id").in("id", (before.data ?? []).map((row) => row.id as string));
    expect(after.data?.every((row) => row.actor_id === f.bId)).toBe(true);
  });

  it("once transferred, the former sole Owner can delete their account", async () => {
    await f.a.rpc("transfer_ownership", { p_project_id: f.projectId, p_new_owner_id: f.bId });
    const { data, error } = await f.a.rpc("delete_own_account");
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.deleted).toBe(true);
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/account-deletion.test.ts`
Expected: FAIL — `delete_own_account()` does not exist.

- [x] **Step 3: Migration**

```sql
-- supabase/migrations/202609200001_account_deletion.sql
-- Mirrors 202609180002_ownership_lifecycle.sql's soft_delete_project Owner
-- guard, one level up: a user cannot delete their own account while they
-- are the sole Owner of any project, exactly as an Owner cannot leave_project
-- without transferring first (2B.5/2B.6). The users row is ANONYMISED, not
-- deleted — tasks.created_by and activity.actor_id both reference it, and
-- the audit trail must survive account deletion (04 §4.10).
create or replace function public.delete_own_account()
returns table (deleted boolean, blocked_projects jsonb)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  sole_owner_projects jsonb;
  tombstone_email text;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;

  select jsonb_agg(jsonb_build_object('projectId', p.id, 'projectName', p.name))
    into sole_owner_projects
    from public.memberships m
    join public.projects p on p.id = m.project_id and p.deleted_at is null
    where m.user_id = current_user_id
      and m.role = 'owner'
      and not exists (
        select 1 from public.memberships other
        where other.project_id = m.project_id and other.role = 'owner' and other.user_id <> current_user_id
      );

  if sole_owner_projects is not null then
    raise exception 'ACCOUNT_DELETE_BLOCKED' using errcode = '42501', detail = sole_owner_projects::text;
  end if;

  tombstone_email := 'deleted-' || gen_random_uuid()::text || '@kanbo.invalid';

  -- Unassign open tasks and record who was unassigned (same shape as
  -- remove_member in 202609170002_members.sql).
  update public.tasks
    set assignee_id = null
    where tasks.assignee_id = current_user_id and tasks.deleted_at is null;

  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value)
  select m.project_id, current_user_id, 'membership', current_user_id, 'member_removed', jsonb_build_object('userId', current_user_id, 'reason', 'account_deleted')
  from public.memberships m
  where m.user_id = current_user_id;

  delete from public.memberships where memberships.user_id = current_user_id;

  update public.users
    set display_name = 'Deleted user',
        email = tombstone_email::citext,
        avatar_url = null,
        deleted_at = now()
    where users.id = current_user_id;

  return query select true, null::jsonb;
end;
$$;
revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
```

Note: `users.deleted_at` already exists in `202609090001_data_core.sql` but is not currently set by any code path — `handle_new_user`/`users_self` policy already filter nothing on it (the `users_self` policy is `id = auth.uid()`, unaffected by `deleted_at`), so setting it here is additive and does not change any existing RLS behaviour; it exists purely so a future "was this account ever deleted" check has a timestamp rather than only the tombstone email pattern to go on.

- [x] **Step 4: Apply and run the RLS suite**

Run: `npm run db:push` then `npm run test:rls -- src/test/rls/account-deletion.test.ts`.
Expected: PASS.

- [x] **Step 5: Route**

```ts
// src/app/api/v1/users/me/route.ts
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError } from "@/lib/api/response";

export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    unauthenticatedMessage: "Sign in to delete your account.",
  },
  async ({ supabase, user, requestId }) => {
    const { data, error } = await supabase.rpc("delete_own_account");
    if (error) {
      if (error.code === "42501") {
        const blocked: unknown = (error as { detail?: string }).detail
          ? JSON.parse((error as { detail?: string }).detail as string)
          : [];
        return apiError(
          409,
          "CONFLICT",
          "You're the only Owner on one or more projects. Transfer ownership or delete those projects before deleting your account.",
          { blockedProjects: blocked },
        );
      }
      return mapRpcError(error, { message: "Account could not be deleted.", requestId });
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.deleted) {
      return apiError(500, "INTERNAL_ERROR", "Account could not be deleted.", { requestId });
    }

    // End the session server-side so a token captured from this same
    // request cannot be replayed anywhere else — the one place in this
    // codebase the service-role client acts on the calling user's own
    // account rather than another user's.
    const admin = createAdminClient();
    await admin.auth.admin.signOut(user.id, "global");

    return json({ data: { deleted: true } });
  },
);
```

- [x] **Step 6: Failing component test for the danger-zone confirmation**

```tsx
// src/components/settings/danger-zone.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DangerZone } from "./danger-zone";

describe("DangerZone", () => {
  it("disables the delete button until the confirmation phrase matches", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<DangerZone onDelete={onDelete} confirmationPhrase="delete my account" />);
    const button = screen.getByRole("button", { name: /delete account/i });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/type.*to confirm/i), "delete my account");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onDelete).toHaveBeenCalled();
  });

  it("shows the blocked-projects message on a 409 from the server", async () => {
    const onDelete = vi.fn().mockRejectedValue(
      Object.assign(new Error("You're the only Owner on one or more projects. Transfer ownership or delete those projects before deleting your account."), {
        blockedProjects: [{ projectId: "p1", projectName: "Launch Plan" }],
      }),
    );
    render(<DangerZone onDelete={onDelete} confirmationPhrase="delete my account" />);
    await userEvent.type(screen.getByLabelText(/type.*to confirm/i), "delete my account");
    await userEvent.click(screen.getByRole("button", { name: /delete account/i }));
    expect(await screen.findByText(/only Owner/i)).toBeInTheDocument();
  });
});
```

- [x] **Step 7: Run to verify it fails** — `npx vitest run src/components/settings/danger-zone.test.tsx` → FAIL, module not found.

- [x] **Step 8: Implement `DangerZone`**

```tsx
// src/components/settings/danger-zone.tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DangerZone({
  onDelete,
  confirmationPhrase,
}: {
  onDelete: () => Promise<void>;
  confirmationPhrase: string;
}) {
  const [typed, setTyped] = useState(""),
    [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState(false);

  async function handleDelete() {
    setPending(true);
    setError(null);
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your account could not be deleted.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border-destructive/40 mt-8 space-y-4 rounded-xl border p-5">
      <h2 className="text-destructive text-sm font-semibold">Danger zone</h2>
      <p className="text-muted-foreground text-sm">
        Deleting your account anonymises your profile and removes you from every project. This cannot be
        undone.
      </p>
      <label className="block text-sm font-medium" htmlFor="delete-confirm">
        Type &quot;{confirmationPhrase}&quot; to confirm
        <Input
          id="delete-confirm"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          className="mt-2"
        />
      </label>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button
        variant="destructive"
        disabled={typed !== confirmationPhrase || pending}
        onClick={() => void handleDelete()}
      >
        {pending ? "Deleting…" : "Delete account"}
      </Button>
    </div>
  );
}
```

Wire `DangerZone` into the account settings page (created in 2F.5 per the roadmap) with an `onDelete` that calls `DELETE /api/v1/users/me`, throws an `Error` carrying the server's message and `blockedProjects` on non-2xx, and on success redirects to `/login` (the session is already invalidated server-side by Step 5) — follow the same `fetch`/`useState` error-surfacing pattern as `ProjectSettingsForm` (`src/components/projects/project-settings-form.tsx`) rather than introducing a new one.

- [x] **Step 9: Run to verify it passes** — `npx vitest run src/components/settings/danger-zone.test.tsx` → PASS.

- [x] **Step 10: Run full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint`
Expected: all PASS.

```bash
git add supabase/migrations/202609200001_account_deletion.sql src/app/api/v1/users src/components/settings/danger-zone.tsx src/components/settings/danger-zone.test.tsx src/test/rls/account-deletion.test.ts
git commit -m "feat(account): add account deletion with a sole-Owner guard and anonymisation"
```

---

### Task 2G.6 — CSP nonce (T6) + security acceptance run

**Files:**
- Create: `src/lib/security/csp.ts`, `src/lib/security/csp.test.ts`, `docs/security-acceptance.md`
- Modify: `middleware.ts`, `src/lib/security/headers.ts`, `next.config.ts`

**Interfaces:**
- Produces: `buildCsp(params: { nonce: string; supabaseUrl: string; sentryDsn?: string; isDev: boolean }): string`.

**Security properties:** the nonce is 16+ CSPRNG bytes, base64-encoded, generated fresh per request (never reused across requests, never derived from anything guessable like the request path or timestamp); `script-src` in production contains only `'self'` and the per-request nonce — `'unsafe-inline'` is gone; the nonce never appears in a log line (it's a header value, not passed to `log()`).

- [ ] **Step 1: Failing test for `buildCsp`**

```ts
// src/lib/security/csp.test.ts
import { describe, expect, it } from "vitest";
import { buildCsp } from "./csp";

describe("buildCsp", () => {
  it("uses the nonce and drops unsafe-inline for scripts in production", () => {
    const csp = buildCsp({ nonce: "abc123", supabaseUrl: "https://proj.supabase.co", isDev: false });
    expect(csp).toContain("script-src 'self' 'nonce-abc123'");
    expect(csp).not.toContain("unsafe-inline");
  });

  it("keeps unsafe-eval for dev only, still nonce-based", () => {
    const csp = buildCsp({ nonce: "abc123", supabaseUrl: "https://proj.supabase.co", isDev: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'unsafe-eval'");
  });

  it("includes the Supabase origin and its websocket equivalent in connect-src", () => {
    const csp = buildCsp({ nonce: "x", supabaseUrl: "https://proj.supabase.co", isDev: false });
    expect(csp).toContain("connect-src 'self' https://proj.supabase.co wss://proj.supabase.co");
  });

  it("appends the Sentry origin to connect-src when a DSN is set", () => {
    const csp = buildCsp({ nonce: "x", supabaseUrl: "https://proj.supabase.co", sentryDsn: "https://key@o0.ingest.sentry.io/1", isDev: false });
    expect(csp).toContain("https://o0.ingest.sentry.io");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/security/csp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildCsp`**

```ts
// src/lib/security/csp.ts
export function buildCsp(params: {
  nonce: string;
  supabaseUrl: string;
  sentryDsn?: string;
  isDev: boolean;
}): string {
  const origin = new URL(params.supabaseUrl).origin;
  const websocketOrigin = origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const sentryOrigin = params.sentryDsn ? ` ${new URL(params.sentryDsn).origin}` : "";
  const scriptSource = params.isDev
    ? `script-src 'self' 'nonce-${params.nonce}' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${params.nonce}'`;

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    `connect-src 'self' ${origin} ${websocketOrigin}${sentryOrigin}`,
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline'",
    scriptSource,
  ].join("; ");
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/security/csp.test.ts` → PASS.

- [ ] **Step 5: Wire the nonce through middleware**

Read `src/lib/supabase/middleware.ts` and `middleware.ts` first (both already shown in this plan's grounding — `updateSession` builds a `NextResponse` incrementally as cookies are set) so the nonce logic composes with the existing session-refresh response rather than replacing it.

```ts
// middleware.ts
import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { buildCsp } from "@/lib/security/csp";
import { clientEnv } from "@/lib/env";

export async function middleware(request: NextRequest) {
  const nonce = randomBytes(16).toString("base64");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  const requestWithNonce = new NextRequest(request, { headers: requestHeaders });

  const sessionResponse = await updateSession(requestWithNonce);
  const response = sessionResponse ?? NextResponse.next({ request: { headers: requestHeaders } });

  const csp = buildCsp({
    nonce,
    supabaseUrl: clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    sentryDsn: clientEnv.NEXT_PUBLIC_SENTRY_DSN,
    isDev: process.env.NODE_ENV === "development",
  });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-nonce", nonce);

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

`updateSession` currently returns `NextResponse.next({ request })`/`NextResponse.redirect(url)` — both are plain `Response`-like objects that accept `.headers.set(...)`, so setting the CSP header after the fact on whatever `updateSession` produced (redirect included — a redirect response still needs security headers) is safe and requires no change to `src/lib/supabase/middleware.ts` itself.

- [ ] **Step 6: Drop script-src from the static headers, keep everything else**

```ts
// src/lib/security/headers.ts
export function securityHeaders(supabaseUrl: string) {
  // Content-Security-Policy is now set per-request in middleware.ts (T6 —
  // it needs the per-request nonce). Every other header here is static and
  // safe to keep serving from next.config.ts's headers(), including as a
  // fallback for any response path middleware doesn't touch (e.g. static
  // assets excluded by middleware's matcher).
  void supabaseUrl;
  return [
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
  ];
}
```

`next.config.ts`'s `headers()` function is unchanged — it still calls `securityHeaders(supabaseUrl)`, which now simply returns a shorter list. Confirm the existing test for `securityHeaders` (if one exists) is updated to match the new return shape rather than asserting on the removed CSP entry.

- [ ] **Step 7: Run full checks**

Run: `npm run test && npm run typecheck && npm run lint && npm run build`
Expected: all PASS. Manually load the app in a dev server and confirm in DevTools → Network → any document response that `Content-Security-Policy` has `script-src 'self' 'nonce-…'` with a different nonce value on every reload, and that the page still hydrates (confirms Next is actually reading `x-nonce` and stamping it onto its own script tags).

- [ ] **Step 8: Security acceptance walk — write `docs/security-acceptance.md`**

Walk `docs/specs/07 §18` items 1–12 one by one. For each item, name the concrete test file(s)/CI job that proves it and a one-line note; below is the skeleton this plan can already fill in from tests written across 2A–2G (an agent executing this step must open `07 §18` itself to confirm each item's exact wording and check nothing is missed — the list below is this plan's best-effort mapping from the roadmap's own item references, not a substitute for reading the source spec):

```markdown
# Security acceptance — 07 §18

| # | Item (see docs/specs/07 §18 for full text) | Evidence |
|---|---|---|
| 1 | RLS isolation — B never reads A's rows | `src/test/rls/isolation.test.ts`, `members.test.ts`, `project-lifecycle.test.ts` |
| 2 | Project-scoped 404 vs 403 | `src/test/rls/members.test.ts` (`project-scoped 404` describe block), `mapRpcError` tests in `src/lib/api/handler.test.ts` |
| 4 | Rate limiting (writes/reads/invitations/analytics) | `src/lib/api/rate-limit.test.ts`, `202609110001_rate_limits.sql` |
| 5 | RLS negative tests run in CI against staging | `.github/workflows/ci.yml` `rls` job |
| 6 | Removed member's session is cut immediately | `src/test/rls/members-lifecycle.test.ts`, `use-project-channel.ts` membership-delete handler (2B.5) |
| 7 | XSS corpus renders inert (comments/markdown) | `src/lib/comments/markdown.test.ts` (2D.2) |
| 9 | HIBP breach check, no full hash leaves the server | `src/lib/auth/breach-check.test.ts` (2A.8) |
| 12 | Non-member gets identical (404) response regardless of project existing | `src/test/rls/members.test.ts` |
| — | Account deletion cannot orphan sole-Owner projects | `src/test/rls/account-deletion.test.ts` (2G.5) |
| — | CSP has no 'unsafe-inline' script-src in production | `src/lib/security/csp.test.ts` (2G.6), manual DevTools check (Step 7 above) |
| — | Cron/service-role endpoints unreachable without CRON_SECRET | `src/app/api/cron/snapshot-heartbeat/route.test.ts` (2G.1) |

Items 3, 8, 10, 11 (fill in against the actual `07 §18` numbering — this plan was written without that file's exact item text in context) map to the CSRF/origin check in `withApiHandler` (`src/lib/api/handler.ts`'s origin-mismatch branch), the Idempotency-Key replay tests (`src/lib/api/idempotency.test.ts`), the unsubscribe-token constant-time verify (2F.5), and the cron `CRON_SECRET` constant-time compare (2G.1) respectively — confirm each against the spec text before marking this table complete.
```

- [ ] **Step 9: Run full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build`
Expected: all PASS.

```bash
git add middleware.ts src/lib/security/csp.ts src/lib/security/csp.test.ts src/lib/security/headers.ts docs/security-acceptance.md
git commit -m "feat(security): move CSP to a per-request nonce in middleware and record the 07 §18 acceptance walk"
```

---

### Task 2G.7 — Production launch

**Files:** operator steps only — no application code changes beyond doc updates (`README.md`, `docs/runbook.md`).

This task is executed against real infrastructure (`kanbo-prod`, the production Vercel project) rather than TDD'd like the others — it has no failing-test step because there is no code under test, only a launch checklist. Follow it in order; each step is a precondition for the next.

- [ ] **Step 1: Final pre-launch verification on staging**

Run against the staging preview deployment (not local): every Playwright flow from `00-master-roadmap.md` §6 (J1 signup→project→task, J4 invite→accept, J2 comment→drag→done, J3 filter overdue→analytics), plus a manual click-through of account deletion (Task 2G.5: attempt as a sole Owner, confirm it's blocked with the project named, transfer ownership, delete successfully, confirm session is dead) and the CSP nonce (Task 2G.6: DevTools confirms no `unsafe-inline` in `script-src` in the staging build, which already runs `NODE_ENV=production`).

- [ ] **Step 2: Push migrations to `kanbo-prod`**

```bash
npx supabase link --project-ref <prod-project-ref>
npx supabase db push
```
Expected: every migration from `202609090001` through `202609200001` (and this task's own, if any) applies cleanly in order. Confirm with `npx supabase migration list` showing no pending migrations against prod.

- [ ] **Step 2b: Re-run the RLS suite against `kanbo-prod` once, then never again with prod as the default target**

```bash
SUPABASE_URL=<prod-url> SUPABASE_ANON_KEY=<prod-anon-key> SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key> npm run test:rls
```
Expected: PASS. This is a one-time confirmation that the schema behaves identically in prod; CI's `rls` job continues to target staging, per the existing `.github/workflows/ci.yml` `env` block, which this task does not change.

- [ ] **Step 3: Promote the Vercel project to production**

Set every environment variable from `.env.example` in the Vercel project's Production environment (prod Supabase URL/keys, `CRON_SECRET`, `UNSUBSCRIBE_SECRET`, `EMAIL_PROVIDER=resend` if 2F.7 shipped or `console` otherwise, `SENTRY_*`, `NEXT_PUBLIC_SITE_URL` pointed at the production domain), matching Task 2A.3's per-environment split. Then:

```bash
vercel deploy --prod
```

- [ ] **Step 4: Uptime check**

Configure a free-tier uptime monitor (any provider — UptimeRobot's free tier is the obvious default, no dependency added to the codebase) hitting `https://<prod-domain>/` on a 5-minute interval. Record the monitor URL/dashboard link in `docs/runbook.md`.

- [ ] **Step 5: Confirm the backup story (T17) end-to-end against prod**

Verify `.github/workflows/backup.yml` (Task 2A.7) has produced at least one encrypted dump artifact for `kanbo-prod` since it was linked, and that the keep-alive ping in the same workflow covers the prod REST endpoint alongside staging/dev. If a restore drill into `kanbo-dev` has not yet been logged per Task 2A.7's acceptance criteria, perform one now:

```bash
# Download the latest backup.yml artifact, then:
npx supabase db reset --linked --db-url <kanbo-dev-connection-string>
psql <kanbo-dev-connection-string> < prod-dump.sql
npm run test:rls   # against kanbo-dev, confirms the restored schema still passes every RLS check
```
Log the date, artifact id, and outcome in `docs/runbook.md`'s restore-drill section.

- [ ] **Step 6: Update docs and commit**

Update `README.md` with the production URL and a one-paragraph "Kanbo is live" note; update `docs/runbook.md` with the uptime-monitor link, the restore-drill log entry from Step 5, and a short "if the site is down" triage order (check the uptime monitor → check Vercel deployment status → check Supabase project isn't paused → check Sentry for a spike). No application code changes in this commit.

```bash
git add README.md docs/runbook.md
git commit -m "docs: record production launch — uptime monitor, restore drill, live URL"
```

- [ ] **Step 7: Close the loop with the roadmap's MVP gate**

Confirm every item in `00-master-roadmap.md` §6 "MVP gate": `07 §18` all 12 items evidenced (`docs/security-acceptance.md`, Task 2G.6), `01 §25` budgets measured on staging (Lighthouse LCP < 2.5s, board bundle < 250 KB gz via `npm run size`, API p95 via Vercel logs), `board_snapshots` has ≥1 row per project before analytics was exposed (Task 2G.1 — already true, since 2G.1 shipped before 2G.3), digest reconciliation test green (2F.6, prior sub-plan), restore drill completed and logged (Step 5 above). This is a checklist review, not new code — if any item is red, that is a defect to fix before declaring the MVP complete, not a note to defer.

---

## Verification (sub-plan exit — and MVP completion)

- **Per task:** `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build && npm run size` green, per the Global Constraints commit rule.
- **Sub-plan exit (2G, covering both files):** every RLS test file added across 2G (`analytics.test.ts`, `purge.test.ts`, `account-deletion.test.ts`) green against `kanbo-dev`; `docs/security-acceptance.md` complete with no unresolved item; CSP has zero `unsafe-inline` occurrences in a production build's response headers.
- **MVP gate (this closes out `00-master-roadmap.md` in full — there is no Sub-plan 2H):** see `00-master-roadmap.md` §6 verbatim — `07 §18` all 12 items evidenced; `01 §25` performance budgets measured on staging; `board_snapshots` seeded before the dashboard was exposed; digest reconciliation test green (2F.6); restore drill completed and logged (Task 2G.7 Step 5). Playwright flows J1–J4 (`00-master-roadmap.md` §6) green on the production domain, not just staging, before calling the MVP done.
- Out-of-scope confirmation: nothing in `00-master-roadmap.md` §7 (attachments, calendar, share links, recurring tasks, timeline, saved filters, CSV export, bulk edit, presence, MFA, i18n, org/tenant entity, AI features) should have crept into any task across 2A–2G; if it has, that's a scope violation to flag, not ship.

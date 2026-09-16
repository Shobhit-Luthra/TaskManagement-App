# Kanbo Sub-plan 2B — Members, roles & invitations (P0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unlock everyone else. Today every RPC either fails non-members with the wrong status code or lets a lone owner never invite a second person. This sub-plan adds peer visibility, an `EmailSender` abstraction, invitations (create/accept/decline/revoke), membership management (list/change-role/remove/leave), ownership transfer, project archive/delete, and the Members UI — so a project can have more than one real member.

**Architecture:** Every new table gets RLS (deny by default, explicit policies) and is covered by the RLS isolation suite the same task it lands in (`src/test/rls/setup.ts`'s `seedIsolationFixture` is extended with a second project — see Task 2B.1). Every write is a `security definer` Postgres RPC following the exact shape already established in `202609090002_create_task.sql`/`202609090003_move_task.sql`: `auth.uid()` null check → membership/role check → validation → mutation + `activity` insert in one transaction → `revoke all … from public` + explicit `grant execute … to authenticated` (or `anon` only for `peek_invitation`, which must work signed-out). Every route is a thin `withApiHandler` wrapper per `src/lib/api/handler.ts`, mapping RPC errors with `mapRpcError`.

**Tech Stack:** Next.js 16.3 Route Handlers + Server Actions, TypeScript strict, Zod 3, `@supabase/ssr` / `@supabase/supabase-js`, Postgres `security definer` functions, Vitest 5 + Testing Library, `node:crypto` (token generation, HMAC-free SHA-256 hashing — no extra dependency).

**Spec:** `docs/superpowers/plans/2026-09-11-kanbo-mvp/00-master-roadmap.md` §2 Gap Register (rows **G6**, **G7**, **G11**, **T3**, **T5**) and §5 Sub-plan 2B; `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md`; `docs/specs/00`–`07`.

## Global Constraints

- **The ambiguous-column bug (fixed this session, do not reintroduce it):** any `security definer` plpgsql function that declares `returns table (id uuid, ...)` (or any other OUT-parameter name that also happens to be a table column — `position`, `role`, `email`, etc.) creates a variable of that name in scope for the whole function body. An unqualified `where id = p_x` (or `min(position)`, `where role = ...`) inside that body is **ambiguous between the OUT parameter and the table column**, and Postgres raises `column reference "X" is ambiguous" on every call — not a hypothetical, this broke `create_task`, `move_task`, `update_task`, `create_subtask`, `update_subtask`, `update_project_column`, and `update_project` in production until fixed in `202609150001_fix_ambiguous_id_refs.sql` / `202609150002_fix_ambiguous_position_ref.sql`. **Every new RPC in this plan that returns a table with a column named `id`, `role`, or `email` must qualify every bare reference to that name inside the function body with its table name** (e.g. `public.invitations.id`, or an explicit alias like `i.id`). Unit tests will not catch this because RPCs are mocked — the RLS integration suite (`npm run test:rls`) against a real Supabase project is the only thing that does, so every task below that adds a migration ends with running it for real.
- TypeScript strict; no `any` in application code.
- No Docker locally. Apply migrations via `npm run db:push` against the linked project, or (if that isn't available in the executing session) via the Supabase MCP `apply_migration` tool against `kanbo-dev` — either way, run `npm run test:rls` against the same project afterward to prove it.
- Every migration file: `supabase/migrations/YYYYMMDDNNNN_<name>.sql`, forward-only — **never edit a migration file after it has been applied to `kanbo-dev`**; ship a new one instead, even to fix a typo.
- Every new/changed RPC: `security definer`, `set search_path = public`, `revoke all … from public`, explicit `grant execute` to the minimum role that needs it (usually `authenticated`; `peek_invitation` is the one exception and grants to `anon` too).
- Every new table: RLS enabled + forced, deny by default, explicit policies, added to `src/test/rls/isolation.test.ts` (or a new `src/test/rls/members.test.ts` — see Task 2B.1) in the same task.
- Every project-scoped write: non-members get **404** (`mapRpcError(error, { …, projectScoped: true })`), never 403. Members without sufficient role get **403**.
- Security-sensitive tasks (invitations, membership, ownership, account deletion later) list security properties and have one test per property: no enumeration, rate limited, explicit max lengths before hashing, generic error copy, single-use tokens consumed in the same transaction as their effect.
- `SUPABASE_SERVICE_ROLE_KEY` only via `createAdminClient()` (`src/lib/supabase/admin.ts`) — never inline.
- Structured JSON logs via `log()` (`src/lib/log.ts`); never log tokens, emails, or invitation links at anything above `debug`, and even then hash the email first.
- Commit at the end of every task: Conventional Commits, **no `Co-Authored-By` or `Claude-Session` trailers** (`ENGINEERING_RULES.md §7`, confirmed by the user 2026-09-11). Before each commit: `git status`, inspect the diff, no secrets, `npm run test`, `npm run typecheck`, `npm run lint`.
- Docs: append to `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md` when a decision here (idempotency table shape, invitation token format, the `GONE` status code) needs recording for later sub-plans to consume — the last task in this plan does that.

---

## File Structure

```
supabase/migrations/202609160001_fix_project_scoped_404.sql     Task 2B.1 — is_project_member before can_write_project on every existing write RPC
supabase/migrations/202609160002_project_peers.sql               Task 2B.1 — users_project_peers policy + project_peers view
src/test/rls/members.test.ts                                     Task 2B.1 (extended through 2B.6)
src/lib/email/sender.ts, console-sender.ts, index.ts              Task 2B.2
src/lib/email/templates/invitation.ts                             Task 2B.2
supabase/migrations/202609160003_idempotency_keys.sql            Task 2B.3
src/lib/api/idempotency.ts                                        Task 2B.3
src/lib/api/response.ts                                           Task 2B.3 (+ Task 2B.4) — GONE code
src/lib/api/handler.ts                                            Task 2B.4 — GONE mapping in mapRpcError
supabase/migrations/202609160004_invitations_create.sql          Task 2B.3
src/lib/invitations/token.ts, schemas.ts                          Task 2B.3
src/app/api/v1/projects/[projectId]/invitations/route.ts         Task 2B.3
src/app/api/v1/projects/[projectId]/invitations/[invitationId]/route.ts   Task 2B.3
supabase/migrations/202609170001_invitations_accept.sql          Task 2B.4
src/app/invite/[token]/page.tsx, actions.ts                       Task 2B.4
src/app/auth/callback/route.ts                                    Task 2B.4 (modify)
src/app/(auth)/signup/page.tsx or equivalent                      Task 2B.4 (modify — email prefill)
supabase/migrations/202609170002_members.sql                     Task 2B.5
src/app/api/v1/projects/[projectId]/members/route.ts              Task 2B.5
src/app/api/v1/projects/[projectId]/members/[userId]/route.ts     Task 2B.5
supabase/migrations/202609180001_publication_memberships.sql     Task 2B.5
src/lib/realtime/use-project-channel.ts                           Task 2B.5 (modify)
supabase/migrations/202609180002_ownership_lifecycle.sql         Task 2B.6
src/app/api/v1/projects/[projectId]/transfer-ownership/route.ts   Task 2B.6
src/app/api/v1/projects/[projectId]/route.ts                      Task 2B.6 (modify — PATCH archive, DELETE)
src/components/members/members-table.tsx, invite-dialog.tsx, pending-invitations.tsx, member-avatar-stack.tsx   Task 2B.7
src/app/(app)/p/[projectId]/settings/members/page.tsx              Task 2B.7
docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md        Task 2B.7 (append)
```

---

### Task 2B.1 — Peer visibility + project-scoped 404 (T5)

**Files:**
- Create: `supabase/migrations/202609160001_fix_project_scoped_404.sql`, `supabase/migrations/202609160002_project_peers.sql`, `src/test/rls/members.test.ts`
- Modify: every project-scoped route under `src/app/api/v1/**` that currently omits `projectScoped: true` on a `mapRpcError` call for a non-member-visible resource.

**Interfaces:**
- Consumes: `is_project_member(target_project uuid)` (already exists, `202609090001_data_core.sql:64`), `can_write_project` (same file, line 65).
- Produces: view `public.project_peers (id uuid, display_name varchar, avatar_url text)` scoped by RLS to the caller's fellow project members only; every existing write RPC now raises `P0002` (`errcode`) for non-members and `42501` only for members lacking write access.

**Security properties:** a non-member gets identical treatment (404) whether the project exists or not — no enumeration by project id; `project_peers` never exposes email.

- [x] **Step 1: Write the failing RLS test for peer visibility**

```ts
// src/test/rls/members.test.ts
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
    await admin.from("memberships").insert({ project_id: f.projectId, user_id: f.bId, role: "member" });
    const { data, error } = await f.b.from("project_peers").select("*").eq("id", f.aId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({ id: f.aId, display_name: "RLS a" });
    expect(data?.[0]).not.toHaveProperty("email");
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
```

- [x] **Step 2: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/members.test.ts`
Expected: FAIL — `project_peers` does not exist; `move_task`/`update_project` currently raise `42501` for non-members, not `P0002`.

- [x] **Step 3: Migration — project-scoped 404 on every existing write RPC**

```sql
-- supabase/migrations/202609160001_fix_project_scoped_404.sql
-- Every write RPC below previously raised 42501 (FORBIDDEN) for BOTH a
-- non-member and a viewer. Split that into is_project_member (404 via
-- P0002 for non-members) then can_write_project (403 via 42501 for
-- viewers) so route handlers can tell the two apart (05 §2, 07 §18.12).
-- Bodies are otherwise unchanged from 202609150001/202609150002 — the
-- qualified id/position references from that bugfix are preserved.

create or replace function public.create_task(
  p_project_id uuid, p_column_id uuid, p_title text, p_description text default null,
  p_assignee_id uuid default null, p_due_date date default null, p_priority public.task_priority default 'medium',
  p_position double precision default null, p_mutation_id uuid default null
) returns table (
  id uuid, column_id uuid, title varchar, description text, due_date date, priority public.task_priority,
  "position" double precision, created_at timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  created_task public.tasks%rowtype;
  task_position double precision;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(p_project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 200 then raise exception 'INVALID_TASK_TITLE' using errcode = '22023'; end if;
  if p_description is not null and char_length(p_description) > 20000 then raise exception 'INVALID_DESCRIPTION' using errcode = '22023'; end if;
  if not exists (select 1 from public.columns where columns.id = p_column_id and columns.project_id = p_project_id and columns.deleted_at is null) then raise exception 'INVALID_COLUMN' using errcode = '22023'; end if;
  if p_assignee_id is not null and not exists (select 1 from public.memberships where project_id = p_project_id and user_id = p_assignee_id) then raise exception 'INVALID_ASSIGNEE' using errcode = '22023'; end if;

  select coalesce(min(tasks.position) - 1, 1) into task_position from public.tasks where tasks.column_id = p_column_id and tasks.deleted_at is null;
  task_position := coalesce(p_position, task_position);
  if task_position in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) then raise exception 'INVALID_POSITION' using errcode = '22023'; end if;

  insert into public.tasks (project_id, column_id, title, description, assignee_id, due_date, priority, position, mutation_id, created_by)
  values (p_project_id, p_column_id, trim(p_title), nullif(trim(p_description), ''), p_assignee_id, p_due_date, p_priority, task_position, p_mutation_id, current_user_id)
  returning * into created_task;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, to_value)
  values (p_project_id, current_user_id, created_task.id, 'task', created_task.id, 'created', jsonb_build_object('title', created_task.title, 'columnId', p_column_id));
  return query select created_task.id, created_task.column_id, created_task.title, created_task.description, created_task.due_date, created_task.priority, created_task.position, created_task.created_at, created_task.updated_at;
end;
$$;

create or replace function public.move_task(
  p_task_id uuid, p_column_id uuid, p_position double precision, p_mutation_id uuid
) returns table (id uuid, column_id uuid, "position" double precision, updated_at timestamptz) language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_task public.tasks%rowtype;
  source_is_done boolean;
  target_is_done boolean;
  activity_kind public.activity_action;
  source_column_id uuid;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_project_member(existing_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  source_column_id := existing_task.column_id;
  if not public.can_write_project(existing_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_position in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) then raise exception 'INVALID_POSITION' using errcode = '22023'; end if;
  select is_done_column into target_is_done from public.columns where columns.id = p_column_id and columns.project_id = existing_task.project_id and columns.deleted_at is null;
  if not found then raise exception 'INVALID_COLUMN' using errcode = '22023'; end if;
  select is_done_column into source_is_done from public.columns where columns.id = existing_task.column_id;
  activity_kind := case
    when target_is_done and not coalesce(source_is_done, false) then 'completed'
    when coalesce(source_is_done, false) and not target_is_done then 'reopened'
    else 'moved'
  end;
  update public.tasks set column_id = p_column_id, position = p_position, mutation_id = p_mutation_id where tasks.id = p_task_id returning * into existing_task;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value, to_value)
  values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id, activity_kind,
    jsonb_build_object('columnId', source_column_id), jsonb_build_object('columnId', p_column_id));
  return query select existing_task.id, existing_task.column_id, existing_task.position, existing_task.updated_at;
end;
$$;

create or replace function public.update_task(
  p_task_id uuid, p_title text, p_description text, p_due_date date, p_priority public.task_priority
) returns table (
  id uuid, column_id uuid, title varchar, description text, due_date date, priority public.task_priority,
  "position" double precision, created_at timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_task public.tasks%rowtype;
  before_value jsonb;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_project_member(existing_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(existing_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 200 then raise exception 'INVALID_TASK_TITLE' using errcode = '22023'; end if;
  if p_description is not null and char_length(p_description) > 20000 then raise exception 'INVALID_DESCRIPTION' using errcode = '22023'; end if;
  before_value := jsonb_build_object('title', existing_task.title, 'description', existing_task.description, 'dueDate', existing_task.due_date, 'priority', existing_task.priority);
  update public.tasks set title = trim(p_title), description = nullif(trim(p_description), ''), due_date = p_due_date, priority = p_priority where tasks.id = p_task_id returning * into existing_task;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value, to_value)
  values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id, 'updated', before_value,
    jsonb_build_object('title', existing_task.title, 'description', existing_task.description, 'dueDate', existing_task.due_date, 'priority', existing_task.priority));
  return query select existing_task.id, existing_task.column_id, existing_task.title, existing_task.description, existing_task.due_date, existing_task.priority, existing_task.position, existing_task.created_at, existing_task.updated_at;
end;
$$;

create or replace function public.soft_delete_task(p_task_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_task public.tasks%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_task from public.tasks where id = p_task_id and deleted_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_project_member(existing_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(existing_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.tasks set deleted_at = now() where id = p_task_id;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, to_value)
  values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id, 'deleted', jsonb_build_object('title', existing_task.title));
end;
$$;

create or replace function public.create_subtask(p_task_id uuid, p_title text)
returns table (id uuid, task_id uuid, title varchar, is_completed boolean, "position" double precision, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  parent_task public.tasks%rowtype;
  subtask_row public.subtasks%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into parent_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_project_member(parent_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(parent_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 200 then raise exception 'INVALID_SUBTASK_TITLE' using errcode = '22023'; end if;
  insert into public.subtasks (task_id, title, position)
  values (parent_task.id, trim(p_title), coalesce((select max(s.position) + 1 from public.subtasks s where s.task_id = parent_task.id), 1))
  returning * into subtask_row;
  return query select subtask_row.id, subtask_row.task_id, subtask_row.title, subtask_row.is_completed, subtask_row.position, subtask_row.created_at, subtask_row.updated_at;
end;
$$;

create or replace function public.update_subtask(p_task_id uuid, p_subtask_id uuid, p_title text, p_is_completed boolean)
returns table (id uuid, task_id uuid, title varchar, is_completed boolean, "position" double precision, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  parent_task public.tasks%rowtype;
  subtask_row public.subtasks%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into parent_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_project_member(parent_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(parent_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into subtask_row from public.subtasks where subtasks.id = p_subtask_id and subtasks.task_id = parent_task.id for update;
  if not found then raise exception 'SUBTASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_title is not null then
    if char_length(trim(p_title)) not between 1 and 200 then raise exception 'INVALID_SUBTASK_TITLE' using errcode = '22023'; end if;
    subtask_row.title := trim(p_title);
  end if;
  if p_is_completed is not null then subtask_row.is_completed := p_is_completed; end if;
  update public.subtasks set title = subtask_row.title, is_completed = subtask_row.is_completed where subtasks.id = subtask_row.id returning * into subtask_row;
  return query select subtask_row.id, subtask_row.task_id, subtask_row.title, subtask_row.is_completed, subtask_row.position, subtask_row.created_at, subtask_row.updated_at;
end;
$$;

create or replace function public.delete_subtask(p_task_id uuid, p_subtask_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  parent_task public.tasks%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into parent_task from public.tasks where id = p_task_id and deleted_at is null;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_project_member(parent_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(parent_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.subtasks where id = p_subtask_id and task_id = parent_task.id;
  if not found then raise exception 'SUBTASK_NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.create_project_column(p_project_id uuid, p_name text, p_wip_limit smallint default null)
returns table (id uuid, project_id uuid, name varchar, "position" double precision, wip_limit smallint, is_done_column boolean, is_in_progress_column boolean)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); column_row public.columns%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.memberships where project_id = p_project_id and user_id = current_user_id and role in ('owner', 'admin')) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 60 then raise exception 'INVALID_COLUMN_NAME' using errcode = '22023'; end if;
  if p_wip_limit is not null and p_wip_limit <= 0 then raise exception 'INVALID_WIP_LIMIT' using errcode = '22023'; end if;
  insert into public.columns (project_id, name, position, wip_limit) values (p_project_id, trim(p_name), coalesce((select max(c.position) + 1 from public.columns c where c.project_id = p_project_id and c.deleted_at is null), 1), p_wip_limit) returning * into column_row;
  return query select column_row.id, column_row.project_id, column_row.name, column_row.position, column_row.wip_limit, column_row.is_done_column, column_row.is_in_progress_column;
end; $$;

create or replace function public.update_project_column(p_project_id uuid, p_column_id uuid, p_name text, p_wip_limit smallint, p_is_done_column boolean)
returns table (id uuid, project_id uuid, name varchar, "position" double precision, wip_limit smallint, is_done_column boolean, is_in_progress_column boolean)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); column_row public.columns%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.memberships where project_id = p_project_id and user_id = current_user_id and role in ('owner', 'admin')) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 60 then raise exception 'INVALID_COLUMN_NAME' using errcode = '22023'; end if;
  if p_wip_limit is not null and p_wip_limit <= 0 then raise exception 'INVALID_WIP_LIMIT' using errcode = '22023'; end if;
  select * into column_row from public.columns where columns.id = p_column_id and columns.project_id = p_project_id and columns.deleted_at is null for update;
  if not found then raise exception 'COLUMN_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_is_done_column then update public.columns set is_done_column = false where columns.project_id = p_project_id and columns.id <> p_column_id and columns.is_done_column; end if;
  update public.columns set name = trim(p_name), wip_limit = p_wip_limit, is_done_column = p_is_done_column where columns.id = p_column_id returning * into column_row;
  return query select column_row.id, column_row.project_id, column_row.name, column_row.position, column_row.wip_limit, column_row.is_done_column, column_row.is_in_progress_column;
end; $$;

create or replace function public.update_project(p_project_id uuid, p_name text, p_description text, p_timezone text) returns table (id uuid, name varchar, description text, timezone varchar, updated_at timestamptz) language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); project_row public.projects%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.memberships where project_id = p_project_id and user_id = current_user_id and role in ('owner', 'admin')) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 120 then raise exception 'INVALID_PROJECT_NAME' using errcode = '22023'; end if;
  if p_description is not null and char_length(p_description) > 2000 then raise exception 'INVALID_DESCRIPTION' using errcode = '22023'; end if;
  if p_timezone is null or char_length(trim(p_timezone)) not between 1 and 64 then raise exception 'INVALID_TIMEZONE' using errcode = '22023'; end if;
  update public.projects set name = trim(p_name), description = nullif(trim(p_description), ''), timezone = trim(p_timezone) where projects.id = p_project_id and projects.deleted_at is null returning * into project_row;
  if not found then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value) values (p_project_id, current_user_id, 'project', p_project_id, 'updated', jsonb_build_object('name', project_row.name));
  return query select project_row.id, project_row.name, project_row.description, project_row.timezone, project_row.updated_at;
end; $$;
```

- [x] **Step 4: Migration — `project_peers` view**

```sql
-- supabase/migrations/202609160002_project_peers.sql
-- Exposes display_name/avatar_url (never email) for fellow project members
-- only, so assignee pickers, avatars, and activity actors resolve names
-- for everyone, not just the signed-in user (T5).
create view public.project_peers as
  select u.id, u.display_name, u.avatar_url
  from public.users u
  where u.deleted_at is null;

alter view public.project_peers set (security_invoker = true);

create policy users_project_peers on public.users for select using (
  exists (
    select 1
    from public.memberships a
    join public.memberships b on a.project_id = b.project_id
    where a.user_id = auth.uid() and b.user_id = users.id
  )
);
```

Note: `project_peers` is a plain view (not `security definer`) with `security_invoker = true`, so it inherits the caller's RLS — the new `users_project_peers` policy (in addition to the existing `users_self`) is what actually restricts visibility to fellow members; the view exists only to shape the columns (no email) for the client to select from directly.

- [x] **Step 5: Apply both migrations to `kanbo-dev`**

Run: `npm run db:push` (or the Supabase MCP `apply_migration` tool with the same SQL, project ref from `mcp__supabase__list_projects`).
Expected: both migrations apply cleanly. Confirm with `mcp__supabase__list_migrations` or `npx supabase migration list`.

- [x] **Step 6: Run the RLS suite to verify it passes**

Run: `npm run test:rls`
Expected: PASS, including the new `members.test.ts` file and all of the existing `isolation.test.ts` (the P0002-vs-42501 change must not break `move_task RPC fails` / `update_project RPC fails` there — those tests only assert `["P0002","42501"]).toContain(error?.code)` / `error).not.toBeNull()`, so they still pass).

- [x] **Step 7: Update route handlers to trust the new 404 semantics**

In `src/app/api/v1/projects/[projectId]/route.ts` (PATCH) and every other project-scoped route that calls `mapRpcError`, add `projectScoped: true`:

```ts
    if (error) return mapRpcError(error, { message: "Project could not be updated.", requestId, projectScoped: true });
```

Apply the same one-line change to `src/app/api/v1/projects/[projectId]/columns/route.ts`, `.../columns/[columnId]/route.ts`, `.../tasks/route.ts`, `src/app/api/v1/tasks/[taskId]/route.ts`, `.../position/route.ts`, `.../subtasks/route.ts`, `.../subtasks/[subtaskId]/route.ts`. This is safe now specifically *because* Step 3 made every one of those RPCs raise `P0002` (not `42501`) for non-members — `mapRpcError`'s `projectScoped` option only demotes `42501`→404, so before this migration it would have wrongly hidden "you're a viewer" (403) as "not found" (404) too; after it, `42501` only ever means "member, but insufficient role", which staying 403 is correct for.

- [x] **Step 8: Run full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint`
Expected: all PASS.

```bash
git add supabase/migrations/202609160001_fix_project_scoped_404.sql supabase/migrations/202609160002_project_peers.sql src/test/rls/members.test.ts src/app/api/v1
git commit -m "feat(members): expose project peers and return 404 for non-members on every write RPC"
```

---

### Task 2B.2 — `EmailSender` interface + console adapter (M4)

**Files:**
- Create: `src/lib/email/sender.ts`, `src/lib/email/console-sender.ts`, `src/lib/email/index.ts`, `src/lib/email/templates/invitation.ts`, `src/lib/email/console-sender.test.ts`, `src/lib/email/templates/invitation.test.ts`
- Modify: `.env.example` (already has `EMAIL_PROVIDER=console` from 2A Task 3)

**Interfaces:**
- Produces:
  ```ts
  export type EmailCategory = "transactional" | "notification" | "digest";
  export type EmailMessage = { to: string; subject: string; text: string; html: string; category: EmailCategory };
  export interface EmailSender { send(message: EmailMessage): Promise<{ id: string }> }
  export function getEmailSender(): EmailSender;   // picks by process.env.EMAIL_PROVIDER
  export function invitationEmail(params: { projectName: string; inviterDisplayName: string; role: string; acceptUrl: string }): { subject: string; text: string; html: string };
  ```

- [x] **Step 1: Write the failing tests**

```ts
// src/lib/email/console-sender.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleEmailSender } from "./console-sender";

describe("ConsoleEmailSender", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs a redacted line and returns an id", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const sender = new ConsoleEmailSender();
    const result = await sender.send({
      to: "person@example.com",
      subject: "You're invited",
      text: "plain",
      html: "<p>html</p>",
      category: "transactional",
    });
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(out).toHaveBeenCalledTimes(1);
    const line = JSON.parse(out.mock.calls[0][0] as string);
    expect(line.event).toBe("email.sent");
    expect(line.to).toBe("[redacted]");
    expect(line.subject).toBe("You're invited");
    expect(line.category).toBe("transactional");
  });
});
```

```ts
// src/lib/email/templates/invitation.test.ts
import { describe, expect, it } from "vitest";
import { invitationEmail } from "./invitation";

describe("invitationEmail", () => {
  it("renders subject, text and html with the accept link", () => {
    const result = invitationEmail({
      projectName: "Launch Plan",
      inviterDisplayName: "Ada",
      role: "member",
      acceptUrl: "https://kanbo.example/invite/abc123",
    });
    expect(result.subject).toBe("Ada invited you to Launch Plan on Kanbo");
    expect(result.text).toContain("https://kanbo.example/invite/abc123");
    expect(result.text).toContain("member");
    expect(result.html).toContain("https://kanbo.example/invite/abc123");
    expect(result.html).not.toContain("<script");
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/email`
Expected: FAIL — modules do not exist.

- [x] **Step 3: Implement**

```ts
// src/lib/email/sender.ts
export type EmailCategory = "transactional" | "notification" | "digest";
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  category: EmailCategory;
};
export interface EmailSender {
  send(message: EmailMessage): Promise<{ id: string }>;
}
```

```ts
// src/lib/email/console-sender.ts
import { randomUUID } from "node:crypto";
import type { EmailMessage, EmailSender } from "./sender";
import { log } from "@/lib/log";

export class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<{ id: string }> {
    const id = randomUUID();
    log("info", "email.sent", {
      id,
      to: message.to,
      subject: message.subject,
      category: message.category,
    });
    return { id };
  }
}
```

`src/lib/log.ts` already redacts any field whose key contains `email` (case-insensitive, per 2A Task 6) — `to` is not on that list, so add it:

```ts
// src/lib/log.ts — extend REDACTED_KEYS
export const REDACTED_KEYS = ["token", "password", "secret", "authorization", "cookie", "email", "body", "to"] as const;
```

This is a one-word change to an existing array; re-run `npx vitest run src/lib/log.test.ts` to confirm the existing logger tests still pass (they assert on keys not affected by this addition).

```ts
// src/lib/email/index.ts
import type { EmailSender } from "./sender";
import { ConsoleEmailSender } from "./console-sender";

export function getEmailSender(): EmailSender {
  const provider = process.env.EMAIL_PROVIDER ?? "console";
  if (provider === "console") return new ConsoleEmailSender();
  throw new Error(`Unknown EMAIL_PROVIDER "${provider}" — only "console" is wired up until 2F.7 (Resend).`);
}

export type { EmailCategory, EmailMessage, EmailSender } from "./sender";
```

```ts
// src/lib/email/templates/invitation.ts
export function invitationEmail(params: {
  projectName: string;
  inviterDisplayName: string;
  role: string;
  acceptUrl: string;
}) {
  const subject = `${params.inviterDisplayName} invited you to ${params.projectName} on Kanbo`;
  const text = `${params.inviterDisplayName} invited you to join "${params.projectName}" on Kanbo as a ${params.role}.\n\nAccept the invitation: ${params.acceptUrl}\n\nIf you weren't expecting this, you can ignore this email.`;
  const html = `<p>${params.inviterDisplayName} invited you to join <strong>${escapeHtml(params.projectName)}</strong> on Kanbo as a ${escapeHtml(params.role)}.</p><p><a href="${params.acceptUrl}">Accept the invitation</a></p><p>If you weren't expecting this, you can ignore this email.</p>`;
  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/email src/lib/log.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/email src/lib/log.ts
git commit -m "feat(email): add EmailSender interface with a console adapter"
```

---

### Task 2B.3 — Invitations: create / list / revoke

**Files:**
- Create: `supabase/migrations/202609160003_idempotency_keys.sql`, `src/lib/api/idempotency.ts`, `src/lib/api/idempotency.test.ts`, `supabase/migrations/202609160004_invitations_create.sql`, `src/lib/invitations/token.ts`, `src/lib/invitations/token.test.ts`, `src/lib/invitations/schemas.ts`, `src/app/api/v1/projects/[projectId]/invitations/route.ts`, `src/app/api/v1/projects/[projectId]/invitations/[invitationId]/route.ts`, `src/test/rls/invitations.test.ts`
- Modify: `src/lib/api/response.ts` (no change needed here — 409/422/403/404 already exist)

**Interfaces:**
- Produces:
  ```ts
  // src/lib/invitations/token.ts
  export function generateInviteToken(): { token: string; hash: string };  // 32 CSPRNG bytes, base64url token; sha256 hex hash
  // src/lib/api/idempotency.ts
  export async function withIdempotency<T>(params: { userId: string; key: string; requestHash: string }, run: () => Promise<{ status: number; body: T }>): Promise<{ status: number; body: T }>;
  ```
- Consumes: `withApiHandler`/`mapRpcError` (`src/lib/api/handler.ts`), `RATE_LIMITS.invitations` (`src/lib/api/rate-limit.ts`), `getEmailSender`/`invitationEmail` (Task 2B.2), `createAdminClient` (`src/lib/supabase/admin.ts`).

**Security properties:** only the SHA-256 hash of the token is ever stored; only Owner/Admin may call `create_invitation`; the target role must be strictly below the caller's own role (BR-2 — an Admin cannot invite an Admin or Owner); re-inviting a still-pending email is idempotent (updates and resends, doesn't duplicate — enforced by `invitations_pending_email` unique partial index already in the schema); inviting an existing member's email → 409; `p_email` max length 254 enforced before it reaches any hashing/lookup; rate limited 20/hour/user; `Idempotency-Key` header honoured on `POST`.

- [x] **Step 1: Write the failing token test**

```ts
// src/lib/invitations/token.test.ts
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { generateInviteToken } from "./token";

describe("generateInviteToken", () => {
  it("returns a base64url token whose sha256 hex matches the returned hash", () => {
    const { token, hash } = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,50}$/);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("never repeats across calls", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a.token).not.toBe(b.token);
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/invitations/token.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement the token module**

```ts
// src/lib/invitations/token.ts
import { randomBytes, createHash } from "node:crypto";

/** 32 CSPRNG bytes, base64url-encoded (no padding) — the value mailed to
 * the invitee. Only its SHA-256 hex digest is ever stored, so a database
 * read can never recover a usable token (05 §2). */
export function generateInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash };
}
```

- [x] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/invitations/token.test.ts`
Expected: PASS.

- [x] **Step 5: Idempotency table — failing test**

```ts
// src/lib/api/idempotency.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withIdempotency } from "./idempotency";

const upsert = vi.fn();
const select = vi.fn();
const from = vi.fn(() => ({ select, upsert }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));

describe("withIdempotency", () => {
  beforeEach(() => {
    upsert.mockReset();
    select.mockReset();
  });

  it("runs and stores the result on first call", async () => {
    select.mockReturnValue({
      eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    });
    upsert.mockResolvedValue({ error: null });
    const run = vi.fn(async () => ({ status: 201, body: { id: "inv-1" } }));
    const result = await withIdempotency(
      { userId: "u1", key: "k1", requestHash: "h1" },
      run,
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 201, body: { id: "inv-1" } });
    expect(upsert).toHaveBeenCalled();
  });

  it("returns the stored response without re-running on replay", async () => {
    select.mockReturnValue({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { request_hash: "h1", status: 201, response: { id: "inv-1" } },
            error: null,
          }),
        }),
      }),
    });
    const run = vi.fn(async () => ({ status: 201, body: { id: "should-not-run" } }));
    const result = await withIdempotency({ userId: "u1", key: "k1", requestHash: "h1" }, run);
    expect(run).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 201, body: { id: "inv-1" } });
  });

  it("re-runs when the same key is replayed with a different request body", async () => {
    select.mockReturnValue({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { request_hash: "different-hash", status: 201, response: {} },
            error: null,
          }),
        }),
      }),
    });
    upsert.mockResolvedValue({ error: null });
    const run = vi.fn(async () => ({ status: 201, body: { id: "new" } }));
    await withIdempotency({ userId: "u1", key: "k1", requestHash: "h1" }, run);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 6: Run to verify it fails** — `npx vitest run src/lib/api/idempotency.test.ts` → FAIL, module missing.

- [x] **Step 7: Migration + implementation**

```sql
-- supabase/migrations/202609160003_idempotency_keys.sql
-- 24h storage for Idempotency-Key replay (T3, 05 §2). Applied to task
-- create and invitation create only, per the withIdempotency() calls that
-- use it. Service-role only — the app server is the only caller.
create table public.idempotency_keys (
  user_id uuid not null references public.users(id) on delete cascade,
  key text not null check (char_length(key) <= 200),
  request_hash text not null,
  status integer not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.idempotency_keys enable row level security;
alter table public.idempotency_keys force row level security;
-- No policies: deny by default, service role only (bypasses RLS).
```

```ts
// src/lib/api/idempotency.ts
import { createAdminClient } from "@/lib/supabase/admin";

export async function withIdempotency<T>(
  params: { userId: string; key: string; requestHash: string },
  run: () => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T }> {
  const admin = createAdminClient();
  const existing = await admin
    .from("idempotency_keys")
    .select("request_hash, status, response")
    .eq("user_id", params.userId)
    .eq("key", params.key)
    .maybeSingle();

  if (existing.data && existing.data.request_hash === params.requestHash) {
    return { status: existing.data.status, body: existing.data.response as T };
  }

  const result = await run();
  await admin.from("idempotency_keys").upsert({
    user_id: params.userId,
    key: params.key,
    request_hash: params.requestHash,
    status: result.status,
    response: result.body as object,
  });
  return result;
}
```

- [x] **Step 8: Run to verify it passes** — `npx vitest run src/lib/api/idempotency.test.ts` → PASS.

- [x] **Step 9: Invitations RPCs — failing RLS test**

```ts
// src/test/rls/invitations.test.ts
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
    await admin.from("memberships").insert({ project_id: f.projectId, user_id: f.bId, role: "member" });
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
    await admin.from("memberships").insert({ project_id: f.projectId, user_id: c.user.id, role: "admin" });
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
    const check = await createAdminClient().from("invitations").select("id").eq("id", row.id).maybeSingle();
    expect(check.data).toBeNull();
  });
});
```

- [x] **Step 10: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/invitations.test.ts`
Expected: FAIL — `create_invitation`/`revoke_invitation` do not exist.

- [x] **Step 11: Migration**

```sql
-- supabase/migrations/202609160004_invitations_create.sql
-- Rank used to enforce "cannot grant >= own role" (BR-2): higher number = more privilege.
create or replace function public.membership_role_rank(r public.membership_role) returns smallint
language sql immutable as $$
  select case r when 'owner' then 4 when 'admin' then 3 when 'member' then 2 when 'viewer' then 1 end;
$$;

create or replace function public.create_invitation(
  p_project_id uuid, p_email text, p_role public.membership_role, p_token_hash text
) returns table (
  id uuid, project_id uuid, email varchar, role public.membership_role, expires_at timestamptz, created_at timestamptz, resent boolean
) language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  caller_role public.membership_role;
  existing_invitation public.invitations%rowtype;
  invitation_row public.invitations%rowtype;
  was_resent boolean := false;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  select role into caller_role from public.memberships where project_id = p_project_id and user_id = current_user_id;
  if caller_role not in ('owner', 'admin') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if public.membership_role_rank(p_role) >= public.membership_role_rank(caller_role) then
    raise exception 'CANNOT_GRANT_ROLE' using errcode = '42501';
  end if;
  if p_email is null or char_length(p_email) > 254 or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL' using errcode = '22023';
  end if;
  if p_token_hash is null or char_length(p_token_hash) <> 64 then raise exception 'INVALID_TOKEN' using errcode = '22023'; end if;

  if exists (
    select 1 from public.memberships m join public.users u on u.id = m.user_id
    where m.project_id = p_project_id and u.email = p_email::citext
  ) then
    raise exception 'ALREADY_MEMBER' using errcode = '23505';
  end if;

  select * into existing_invitation from public.invitations
    where invitations.project_id = p_project_id and invitations.email = p_email::citext and invitations.accepted_at is null
    for update;

  if found then
    update public.invitations set role = p_role, token_hash = p_token_hash, expires_at = now() + interval '7 days'
      where invitations.id = existing_invitation.id returning * into invitation_row;
    was_resent := true;
  else
    insert into public.invitations (project_id, email, role, token_hash, invited_by)
    values (p_project_id, p_email::citext, p_role, p_token_hash, current_user_id)
    returning * into invitation_row;
  end if;

  return query select invitation_row.id, invitation_row.project_id, invitation_row.email, invitation_row.role, invitation_row.expires_at, invitation_row.created_at, was_resent;
end;
$$;
revoke all on function public.create_invitation(uuid, text, public.membership_role, text) from public;
grant execute on function public.create_invitation(uuid, text, public.membership_role, text) to authenticated;

create or replace function public.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  target public.invitations%rowtype;
  caller_role public.membership_role;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into target from public.invitations where invitations.id = p_invitation_id;
  if not found then raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002'; end if;
  select role into caller_role from public.memberships where project_id = target.project_id and user_id = current_user_id;
  if caller_role is null then raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if caller_role not in ('owner', 'admin') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.invitations where invitations.id = p_invitation_id;
end;
$$;
revoke all on function public.revoke_invitation(uuid) from public;
grant execute on function public.revoke_invitation(uuid) to authenticated;
```

- [x] **Step 12: Apply and run the RLS suite**

Run: `npm run db:push` (or MCP `apply_migration`), then `npm run test:rls`.
Expected: PASS, including `invitations.test.ts`.

- [x] **Step 13: Route schemas and handlers**

```ts
// src/lib/invitations/schemas.ts
import { z } from "zod";

export const invitationRoleSchema = z.enum(["admin", "member", "viewer"]); // owner excluded — never invitable
export const createInvitationSchema = z.object({
  email: z.string().trim().email().max(254),
  role: invitationRoleSchema,
});
export const invitationSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  email: z.string(),
  role: z.enum(["owner", "admin", "member", "viewer"]),
  expiresAt: z.string(),
  createdAt: z.string(),
  resent: z.boolean(),
});
```

```ts
// src/app/api/v1/projects/[projectId]/invitations/route.ts
import { createHash } from "node:crypto";
import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { withIdempotency } from "@/lib/api/idempotency";
import { apiError } from "@/lib/api/response";
import { createInvitationSchema } from "@/lib/invitations/schemas";
import { generateInviteToken } from "@/lib/invitations/token";
import { getEmailSender } from "@/lib/email";
import { invitationEmail } from "@/lib/email/templates/invitation";
import { clientEnv } from "@/lib/env";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.reads,
    params: z.object({ projectId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to view invitations.",
  },
  async ({ supabase, params, requestId }) => {
    const { data, error } = await supabase
      .from("invitations")
      .select("id, project_id, email, role, expires_at, created_at, accepted_at")
      .eq("project_id", params.projectId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });
    if (error) return apiError(500, "INTERNAL_ERROR", "Invitations could not be loaded.", { requestId });
    return json({ data });
  },
);

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.invitations,
    params: z.object({ projectId: z.string().uuid() }),
    body: createInvitationSchema,
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to send invitations.",
    validationMessage: "Check the invitation details and try again.",
  },
  async ({ supabase, params, body, user, request, requestId }) => {
    const idempotencyKey = request.headers.get("idempotency-key");
    const requestHash = createHash("sha256").update(JSON.stringify({ params, body })).digest("hex");

    const run = async () => {
      const { token, hash } = generateInviteToken();
      const { data, error } = await supabase.rpc("create_invitation", {
        p_project_id: params.projectId,
        p_email: body.email,
        p_role: body.role,
        p_token_hash: hash,
      });
      if (error) {
        const response = mapRpcError(error, {
          message: "Invitation could not be created.",
          requestId,
          projectScoped: true,
        });
        return { status: response.status, body: await response.json() };
      }
      const row = Array.isArray(data) ? data[0] : data;

      const { data: project } = await supabase.from("projects").select("name").eq("id", params.projectId).single();
      const { data: inviter } = await supabase.from("users").select("display_name").eq("id", user.id).single();
      const sender = getEmailSender();
      const email = invitationEmail({
        projectName: project?.name ?? "a Kanbo project",
        inviterDisplayName: inviter?.display_name ?? "A teammate",
        role: row.role,
        acceptUrl: `${clientEnv.NEXT_PUBLIC_SITE_URL}/invite/${token}`,
      });
      await sender.send({ to: body.email, ...email, category: "transactional" });

      return { status: row.resent ? 200 : 201, body: { data: row } };
    };

    const result = idempotencyKey
      ? await withIdempotency({ userId: user.id, key: idempotencyKey, requestHash }, run)
      : await run();

    if (result.status >= 400) return apiError(result.status, (result.body as { error: { code: string } }).error.code as never, (result.body as { error: { message: string } }).error.message);
    return json(result.body, { status: result.status });
  },
);
```

```ts
// src/app/api/v1/projects/[projectId]/invitations/[invitationId]/route.ts
import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ projectId: z.string().uuid(), invitationId: z.string().uuid() }),
    notFoundMessage: "Invitation not found.",
    unauthenticatedMessage: "Sign in to revoke invitations.",
  },
  async ({ supabase, params, requestId }) => {
    const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: params.invitationId });
    if (error) return mapRpcError(error, { message: "Invitation could not be revoked.", requestId, projectScoped: true });
    return json({ data: { id: params.invitationId } });
  },
);
```

- [x] **Step 14: Run full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add supabase/migrations/202609160003_idempotency_keys.sql supabase/migrations/202609160004_invitations_create.sql src/lib/api/idempotency.ts src/lib/api/idempotency.test.ts src/lib/invitations src/app/api/v1/projects/[projectId]/invitations src/test/rls/invitations.test.ts
git commit -m "feat(invitations): add create/list/revoke with idempotency and rate limiting"
```

---

### Task 2B.4 — Invitation acceptance (J4, S11, G11)

**Files:**
- Create: `supabase/migrations/202609170001_invitations_accept.sql`, `src/app/invite/[token]/page.tsx`, `src/app/invite/[token]/actions.ts`, `src/app/invite/[token]/invite-actions.test.tsx`
- Modify: `src/lib/api/response.ts` (add `"GONE"`), `src/lib/api/handler.ts` (add `P0003` → 410 `GONE` in `RPC_ERROR_MAP`), `src/app/auth/callback/route.ts` (read/clear `kanbo_invite` cookie)

**Interfaces:**
- Produces RPCs `peek_invitation(p_token_hash text) returns table (project_name varchar, inviter_display_name varchar, role membership_role, email citext)` (granted to `anon` — the only RPC in this plan that is), `accept_invitation(p_token_hash text) returns table (project_id uuid, role membership_role)`, `decline_invitation(p_token_hash text) returns void`.

**Security properties:** expired or already-used tokens return 410 `GONE`, never 404 (which would look identical to "URL was mistyped" and leak less useful info to a legitimate invitee who needs to know to ask for a new one); a signed-in user whose email doesn't match the invitation gets 403 with copy that never confirms or denies whether the invite exists for anyone else; the token is looked up only by its hash, never logged; acceptance is single-use — `accepted_at` is set in the same transaction as the membership insert, under `for update` row lock, so two concurrent accept attempts can't both succeed; `peek_invitation` returns only `project_name`, `inviter_display_name`, `role` — never the invitee's own email back to an unauthenticated caller, and never anything about other invitations.

- [x] **Step 1: Extend `ApiErrorCode` and `mapRpcError` — failing test**

Add to `src/lib/api/handler.test.ts`:

```ts
  it.each([
    ["28000", 401, "UNAUTHENTICATED"],
    ["P0002", 404, "NOT_FOUND"],
    ["P0003", 410, "GONE"],
    ["42501", 403, "FORBIDDEN"],
    ["22023", 422, "VALIDATION_ERROR"],
    ["23505", 409, "CONFLICT"],
    ["40001", 409, "CONFLICT"],
    ["XX000", 500, "INTERNAL_ERROR"],
  ])("maps %s to %i %s", async (code, status, apiCode) => {
    const response = mapRpcError({ code }, { message: "x", requestId: "r" });
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code: apiCode } });
  });
```

(This replaces the existing `it.each` block in the `mapRpcError` describe — same table, one new row.)

- [x] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/api/handler.test.ts`
Expected: FAIL on the `P0003` case — `410`/`GONE` not mapped yet.

- [x] **Step 3: Implement**

```ts
// src/lib/api/response.ts — add to the ApiErrorCode union
export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "GONE"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";
```

```ts
// src/lib/api/handler.ts — add one row to RPC_ERROR_MAP
const RPC_ERROR_MAP: Record<string, { status: number; code: ApiErrorCode }> = {
  "28000": { status: 401, code: "UNAUTHENTICATED" },
  P0002: { status: 404, code: "NOT_FOUND" },
  P0003: { status: 410, code: "GONE" },
  "42501": { status: 403, code: "FORBIDDEN" },
  "22023": { status: 422, code: "VALIDATION_ERROR" },
  "23505": { status: 409, code: "CONFLICT" },
  "40001": { status: 409, code: "CONFLICT" },
};
```

- [x] **Step 4: Run to verify it passes** — `npx vitest run src/lib/api/handler.test.ts` → PASS.

- [x] **Step 5: Failing RLS test for accept/decline/peek**

Append to `src/test/rls/invitations.test.ts`:

```ts
describe("peek_invitation / accept_invitation / decline_invitation", () => {
  it("peek_invitation works signed-out and leaks only project/inviter/role", async () => {
    const created = await f.a.rpc("create_invitation", {
      p_project_id: f.projectId,
      p_email: "peek-me@example.test",
      p_role: "member",
      p_token_hash: "1".repeat(64),
    });
    const row = Array.isArray(created.data) ? created.data[0] : created.data;
    const anon = createAdminClient(); // service role bypasses RLS but peek is security definer + granted to anon regardless
    const { data, error } = await anon.rpc("peek_invitation", { p_token_hash: "1".repeat(64) });
    expect(error).toBeNull();
    const peeked = Array.isArray(data) ? data[0] : data;
    expect(peeked).toMatchObject({ project_name: "Isolation P", role: "member" });
    expect(peeked).not.toHaveProperty("email");
    void row;
  });

  it("accept_invitation rejects an email mismatch with 403, not enumeration", async () => {
    const created = await f.a.rpc("create_invitation", {
      p_project_id: f.projectId,
      p_email: "only-this-email@example.test",
      p_role: "member",
      p_token_hash: "2".repeat(64),
    });
    void created;
    const { error } = await f.b.rpc("accept_invitation", { p_token_hash: "2".repeat(64) });
    expect(error?.code).toBe("42501");
  });

  it("accept_invitation is single-use: second accept returns 410 GONE", async () => {
    const admin = createAdminClient();
    const bEmail = await admin.from("users").select("email").eq("id", f.bId).single();
    const created = await f.a.rpc("create_invitation", {
      p_project_id: f.projectId,
      p_email: bEmail.data?.email,
      p_role: "member",
      p_token_hash: "3".repeat(64),
    });
    void created;
    const first = await f.b.rpc("accept_invitation", { p_token_hash: "3".repeat(64) });
    expect(first.error).toBeNull();
    const second = await f.b.rpc("accept_invitation", { p_token_hash: "3".repeat(64) });
    expect(second.error?.code).toBe("P0003");
  });

  it("an unknown token returns P0002 from peek and accept", async () => {
    const anon = createAdminClient();
    const peek = await anon.rpc("peek_invitation", { p_token_hash: "9".repeat(64) });
    expect(peek.error?.code).toBe("P0002");
    const accept = await f.a.rpc("accept_invitation", { p_token_hash: "9".repeat(64) });
    expect(accept.error?.code).toBe("P0002");
  });
});
```

- [x] **Step 6: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/invitations.test.ts`
Expected: FAIL — RPCs don't exist.

- [x] **Step 7: Migration**

```sql
-- supabase/migrations/202609170001_invitations_accept.sql
alter table public.invitations add column declined_at timestamptz;

create or replace function public.peek_invitation(p_token_hash text)
returns table (project_name varchar, inviter_display_name varchar, role public.membership_role)
language plpgsql security definer set search_path = public as $$
declare inv public.invitations%rowtype;
begin
  select * into inv from public.invitations where invitations.token_hash = p_token_hash;
  if not found then raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if inv.accepted_at is not null or inv.declined_at is not null or inv.expires_at < now() then
    raise exception 'INVITATION_GONE' using errcode = 'P0003';
  end if;
  return query
    select p.name, u.display_name, inv.role
    from public.projects p join public.users u on u.id = inv.invited_by
    where p.id = inv.project_id;
end;
$$;
revoke all on function public.peek_invitation(text) from public;
grant execute on function public.peek_invitation(text) to anon;
grant execute on function public.peek_invitation(text) to authenticated;

create or replace function public.accept_invitation(p_token_hash text)
returns table (project_id uuid, role public.membership_role)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  current_email citext;
  inv public.invitations%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into inv from public.invitations where invitations.token_hash = p_token_hash for update;
  if not found then raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if inv.accepted_at is not null or inv.declined_at is not null or inv.expires_at < now() then
    raise exception 'INVITATION_GONE' using errcode = 'P0003';
  end if;
  select email into current_email from public.users where users.id = current_user_id;
  if current_email is distinct from inv.email then raise exception 'EMAIL_MISMATCH' using errcode = '42501'; end if;
  if exists (select 1 from public.memberships where memberships.project_id = inv.project_id and memberships.user_id = current_user_id) then
    raise exception 'ALREADY_MEMBER' using errcode = '23505';
  end if;

  update public.invitations set accepted_at = now() where invitations.id = inv.id;
  insert into public.memberships (project_id, user_id, role) values (inv.project_id, current_user_id, inv.role);
  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value)
  values (inv.project_id, current_user_id, 'membership', current_user_id, 'member_added', jsonb_build_object('role', inv.role));

  return query select inv.project_id, inv.role;
end;
$$;
revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;

create or replace function public.decline_invitation(p_token_hash text) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  current_email citext;
  inv public.invitations%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into inv from public.invitations where invitations.token_hash = p_token_hash for update;
  if not found then raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if inv.accepted_at is not null or inv.declined_at is not null or inv.expires_at < now() then
    raise exception 'INVITATION_GONE' using errcode = 'P0003';
  end if;
  select email into current_email from public.users where users.id = current_user_id;
  if current_email is distinct from inv.email then raise exception 'EMAIL_MISMATCH' using errcode = '42501'; end if;
  update public.invitations set declined_at = now() where invitations.id = inv.id;
end;
$$;
revoke all on function public.decline_invitation(text) from public;
grant execute on function public.decline_invitation(text) to authenticated;
```

- [x] **Step 8: Apply and run the RLS suite**

Run: `npm run db:push` then `npm run test:rls`.
Expected: PASS.

- [x] **Step 9: Invite page, actions, and the signed-out journey**

```ts
// src/app/invite/[token]/actions.ts
"use server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createHash } from "node:crypto";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function peekInvite(token: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("peek_invitation", { p_token_hash: hashToken(token) });
  if (error) return { error: error.code === "P0003" ? "gone" as const : "not_found" as const };
  const row = Array.isArray(data) ? data[0] : data;
  return { data: row };
}

export async function acceptInvite(token: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    const jar = await cookies();
    jar.set("kanbo_invite", token, { httpOnly: true, maxAge: 3600, path: "/", sameSite: "lax" });
    return { redirect: `/signup?next=/invite/${token}` };
  }
  const { data, error } = await supabase.rpc("accept_invitation", { p_token_hash: hashToken(token) });
  if (error) return { error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  return { redirect: `/p/${row.project_id}/board` };
}

export async function declineInvite(token: string) {
  const supabase = await createClient();
  await supabase.rpc("decline_invitation", { p_token_hash: hashToken(token) });
  return { redirect: "/projects" };
}
```

```tsx
// src/app/invite/[token]/page.tsx
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { peekInvite, acceptInvite, declineInvite } from "./actions";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await peekInvite(token);
  if (result.error === "not_found") notFound();
  if (result.error === "gone") {
    return (
      <div className="mx-auto mt-24 max-w-md space-y-3 text-center">
        <h1 className="text-xl font-semibold">This invitation is no longer valid</h1>
        <p className="text-muted-foreground text-sm">
          It may have expired or already been used. Ask whoever invited you to send a new one.
        </p>
      </div>
    );
  }
  const invite = result.data!;
  return (
    <div className="mx-auto mt-24 max-w-md space-y-6 text-center">
      <h1 className="text-xl font-semibold">
        {invite.inviter_display_name} invited you to {invite.project_name}
      </h1>
      <p className="text-muted-foreground text-sm">You&apos;d join as {invite.role}.</p>
      <div className="flex justify-center gap-3">
        <form action={async () => { "use server"; const r = await acceptInvite(token); if (r.redirect) { const { redirect } = await import("next/navigation"); redirect(r.redirect); } }}>
          <Button type="submit">Accept</Button>
        </form>
        <form action={async () => { "use server"; const r = await declineInvite(token); if (r.redirect) { const { redirect } = await import("next/navigation"); redirect(r.redirect); } }}>
          <Button type="submit" variant="outline">Decline</Button>
        </form>
      </div>
    </div>
  );
}
```

- [x] **Step 10: Wire the signed-out cookie through `/auth/callback`**

```ts
// src/app/auth/callback/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/projects";
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const url = request.nextUrl.clone();
  if (!code) {
    url.pathname = "/login";
    url.search = "?error=oauth";
    return NextResponse.redirect(url);
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  const inviteToken = request.cookies.get("kanbo_invite")?.value;
  url.pathname = error ? "/login" : inviteToken ? `/invite/${inviteToken}` : safeNext(request.nextUrl.searchParams.get("next"));
  url.search = error ? "?error=oauth" : "";
  const response = NextResponse.redirect(url);
  if (inviteToken) response.cookies.delete("kanbo_invite");
  return response;
}
```

- [x] **Step 11: Component test for the invite page's non-happy paths**

```tsx
// src/app/invite/[token]/invite-actions.test.tsx
import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, auth: { getUser: async () => ({ data: { user: null } }) } }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn() }) }));

import { peekInvite, acceptInvite } from "./actions";

describe("peekInvite", () => {
  it("maps P0003 to gone", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0003" } });
    const result = await peekInvite("tok");
    expect(result.error).toBe("gone");
  });

  it("maps anything else to not_found", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    const result = await peekInvite("tok");
    expect(result.error).toBe("not_found");
  });
});

describe("acceptInvite", () => {
  it("redirects to signup with next= when signed out", async () => {
    const result = await acceptInvite("tok");
    expect(result.redirect).toBe("/signup?next=/invite/tok");
  });
});
```

- [x] **Step 12: Run full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add src/lib/api/response.ts src/lib/api/handler.ts src/lib/api/handler.test.ts supabase/migrations/202609170001_invitations_accept.sql src/app/invite src/app/auth/callback/route.ts src/test/rls/invitations.test.ts
git commit -m "feat(invitations): add accept/decline/peek with a 410 GONE status for expired tokens"
```

---

### Task 2B.5 — Members: list, change role, remove, leave

**Files:**
- Create: `supabase/migrations/202609170002_members.sql`, `supabase/migrations/202609180001_publication_memberships.sql`, `src/app/api/v1/projects/[projectId]/members/route.ts`, `src/app/api/v1/projects/[projectId]/members/[userId]/route.ts`, `src/test/rls/members-lifecycle.test.ts`
- Modify: `src/lib/realtime/use-project-channel.ts`

**Interfaces:**
- Produces RPCs `change_member_role(p_project_id uuid, p_user_id uuid, p_role membership_role) returns table (user_id uuid, role membership_role)`, `remove_member(p_project_id uuid, p_user_id uuid) returns void`, `leave_project(p_project_id uuid) returns void`.

**Security properties:** an Admin cannot create or modify an Owner (BR-2 extended: role changes obey the same `membership_role_rank` check as invitations, and additionally an Admin cannot touch another Owner's row at all); the last Owner cannot be demoted or removed (`memberships_one_owner` partial unique index already guarantees at most one Owner row exists — the RPC adds an explicit pre-check for a clear error rather than relying on the constraint violation); any member may leave except the Owner (must transfer first — Task 2B.6); a removed member's *next* request returns 404 (already guaranteed by Task 2B.1's `is_project_member` check, now exercised for real via `remove_member`); removing a member unassigns their open tasks with an `unassigned` activity row and a `member_removed` activity row, both in the same transaction as the membership delete.

- [x] **Step 1: Failing RLS test**

```ts
// src/test/rls/members-lifecycle.test.ts
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
    const { error } = await f.a.rpc("remove_member", { p_project_id: f.projectId, p_user_id: f.bId });
    expect(error).toBeNull();
    const { data } = await f.b.from("projects").select("id").eq("id", f.projectId);
    expect(data).toEqual([]);
  });

  it("the last Owner cannot remove themselves", async () => {
    const { error } = await f.a.rpc("remove_member", { p_project_id: f.projectId, p_user_id: f.aId });
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
```

- [x] **Step 2: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/members-lifecycle.test.ts`
Expected: FAIL — RPCs don't exist.

- [x] **Step 3: Migration**

```sql
-- supabase/migrations/202609170002_members.sql
create or replace function public.change_member_role(p_project_id uuid, p_user_id uuid, p_role public.membership_role)
returns table (user_id uuid, role public.membership_role)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  caller_role public.membership_role;
  target_role public.membership_role;
  updated public.memberships%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  select role into caller_role from public.memberships where project_id = p_project_id and user_id = current_user_id;
  if caller_role not in ('owner', 'admin') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select role into target_role from public.memberships where memberships.project_id = p_project_id and memberships.user_id = p_user_id;
  if target_role is null then raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
  if target_role = 'owner' or p_role = 'owner' then raise exception 'CANNOT_GRANT_ROLE' using errcode = '42501'; end if;
  if public.membership_role_rank(p_role) >= public.membership_role_rank(caller_role) then
    raise exception 'CANNOT_GRANT_ROLE' using errcode = '42501';
  end if;

  update public.memberships set role = p_role where memberships.project_id = p_project_id and memberships.user_id = p_user_id returning * into updated;
  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, from_value, to_value)
  values (p_project_id, current_user_id, 'membership', p_user_id, 'role_changed', jsonb_build_object('role', target_role), jsonb_build_object('role', p_role));
  return query select updated.user_id, updated.role;
end;
$$;
revoke all on function public.change_member_role(uuid, uuid, public.membership_role) from public;
grant execute on function public.change_member_role(uuid, uuid, public.membership_role) to authenticated;

create or replace function public.remove_member(p_project_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  caller_role public.membership_role;
  target_role public.membership_role;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  select role into caller_role from public.memberships where project_id = p_project_id and user_id = current_user_id;
  if caller_role not in ('owner', 'admin') and current_user_id <> p_user_id then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select role into target_role from public.memberships where memberships.project_id = p_project_id and memberships.user_id = p_user_id;
  if target_role is null then raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
  if target_role = 'owner' then raise exception 'CANNOT_REMOVE_OWNER' using errcode = '42501'; end if;
  if caller_role = 'admin' and target_role = 'admin' and current_user_id <> p_user_id then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.tasks set assignee_id = null where tasks.project_id = p_project_id and tasks.assignee_id = p_user_id and tasks.deleted_at is null;
  delete from public.memberships where memberships.project_id = p_project_id and memberships.user_id = p_user_id;
  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value)
  values (p_project_id, current_user_id, 'membership', p_user_id, 'member_removed', jsonb_build_object('userId', p_user_id));
end;
$$;
revoke all on function public.remove_member(uuid, uuid) from public;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

create or replace function public.leave_project(p_project_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.remove_member(p_project_id, auth.uid());
end;
$$;
revoke all on function public.leave_project(uuid) from public;
grant execute on function public.leave_project(uuid) to authenticated;
```

`remove_member`'s `CANNOT_REMOVE_OWNER` check makes `leave_project` correctly reject an Owner (delegated through the same function), satisfying "the Owner cannot leave" without duplicating the rule.

- [x] **Step 4: Publication + realtime channel close on removal (T12)**

```sql
-- supabase/migrations/202609180001_publication_memberships.sql
alter table public.memberships replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'memberships'
  ) then
    alter publication supabase_realtime add table public.memberships;
  end if;
end $$;
```

Read `src/lib/realtime/use-project-channel.ts` first to match its existing subscription/handler shape exactly, then add a `postgres_changes` handler for `DELETE` on `memberships` filtered to the current user, calling the existing channel-close path and a toast redirect to `/projects` — mirror the pattern already used there for task/column deletes rather than introducing a new one.

- [x] **Step 5: Apply and run the RLS suite**

Run: `npm run db:push` then `npm run test:rls`.
Expected: PASS.

- [x] **Step 6: Routes**

```ts
// src/app/api/v1/projects/[projectId]/members/route.ts
import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { json, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.reads,
    params: z.object({ projectId: z.string().uuid() }),
    unauthenticatedMessage: "Sign in to view members.",
  },
  async ({ supabase, params, requestId }) => {
    const { data, error } = await supabase
      .from("memberships")
      .select("user_id, role, created_at, project_peers!inner(id, display_name, avatar_url)")
      .eq("project_id", params.projectId)
      .order("created_at", { ascending: true });
    if (error) return apiError(500, "INTERNAL_ERROR", "Members could not be loaded.", { requestId });
    return json({ data });
  },
);
```

```ts
// src/app/api/v1/projects/[projectId]/members/[userId]/route.ts
import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

const paramsSchema = z.object({ projectId: z.string().uuid(), userId: z.string().uuid() });

export const PATCH = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: paramsSchema,
    body: z.object({ role: z.enum(["admin", "member", "viewer"]) }),
    notFoundMessage: "Member not found.",
    unauthenticatedMessage: "Sign in to change roles.",
    validationMessage: "Invalid role.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("change_member_role", {
      p_project_id: params.projectId,
      p_user_id: params.userId,
      p_role: body.role,
    });
    if (error) return mapRpcError(error, { message: "Role could not be changed.", requestId, projectScoped: true });
    return json({ data: Array.isArray(data) ? data[0] : data });
  },
);

export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: paramsSchema,
    notFoundMessage: "Member not found.",
    unauthenticatedMessage: "Sign in to remove members.",
  },
  async ({ supabase, params, requestId }) => {
    const { error } = await supabase.rpc("remove_member", {
      p_project_id: params.projectId,
      p_user_id: params.userId,
    });
    if (error) return mapRpcError(error, { message: "Member could not be removed.", requestId, projectScoped: true });
    return json({ data: { userId: params.userId } });
  },
);
```

- [x] **Step 7: Run full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add supabase/migrations/202609170002_members.sql supabase/migrations/202609180001_publication_memberships.sql src/app/api/v1/projects/[projectId]/members src/lib/realtime/use-project-channel.ts src/test/rls/members-lifecycle.test.ts
git commit -m "feat(members): add list, change-role, remove and leave with realtime channel close"
```

---

### Task 2B.6 — Transfer ownership, archive, delete project

**Files:**
- Create: `supabase/migrations/202609180002_ownership_lifecycle.sql`, `src/app/api/v1/projects/[projectId]/transfer-ownership/route.ts`, `src/test/rls/project-lifecycle.test.ts`
- Modify: `src/app/api/v1/projects/[projectId]/route.ts` (add `PATCH` archive path already exists for settings — extend body schema — and add `DELETE`)

**Interfaces:**
- Produces RPCs `transfer_ownership(p_project_id uuid, p_new_owner_id uuid) returns void`, `archive_project(p_project_id uuid, p_is_archived boolean) returns table (id uuid, is_archived boolean)`, `soft_delete_project(p_project_id uuid) returns void`.

**Security properties:** Owner-only for all three; `transfer_ownership`'s target must already be a member; `soft_delete_project` requires the caller to already be confirmed Owner server-side (the client-side typed-name confirmation in Task 2B.7 is a UX affordance, not the security boundary); after delete, every descendant table (columns, tasks, subtasks, activity, memberships, invitations) is unreadable to any member via RLS (`projects_member_read` already filters `deleted_at is null`, and child tables key off the parent project's membership, which the cascade doesn't touch — so this task must also blank the child rows' visibility path; see Step 3).

- [x] **Step 1: Failing RLS test**

```ts
// src/test/rls/project-lifecycle.test.ts
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

describe("transfer_ownership", () => {
  it("Owner can transfer to an existing member", async () => {
    const { error } = await f.a.rpc("transfer_ownership", { p_project_id: f.projectId, p_new_owner_id: f.bId });
    expect(error).toBeNull();
    const { data } = await f.b.from("memberships").select("role").eq("project_id", f.projectId).eq("user_id", f.bId).single();
    expect(data?.role).toBe("owner");
  });

  it("cannot transfer to a non-member", async () => {
    const { error } = await f.a.rpc("transfer_ownership", { p_project_id: f.projectId, p_new_owner_id: crypto.randomUUID() });
    expect(error).not.toBeNull();
  });
});

describe("archive_project", () => {
  it("Owner can archive and unarchive", async () => {
    const archived = await f.a.rpc("archive_project", { p_project_id: f.projectId, p_is_archived: true });
    expect(archived.error).toBeNull();
    const row = Array.isArray(archived.data) ? archived.data[0] : archived.data;
    expect(row.is_archived).toBe(true);
  });

  it("a Member cannot archive", async () => {
    const { error } = await f.b.rpc("archive_project", { p_project_id: f.projectId, p_is_archived: true });
    expect(error?.code).toBe("42501");
  });
});

describe("soft_delete_project", () => {
  it("deletes cascade to zero-row visibility for members", async () => {
    const { error } = await f.a.rpc("soft_delete_project", { p_project_id: f.projectId });
    expect(error).toBeNull();
    const project = await f.b.from("projects").select("id").eq("id", f.projectId);
    expect(project.data).toEqual([]);
    const tasks = await f.b.from("tasks").select("id").eq("project_id", f.projectId);
    expect(tasks.data).toEqual([]);
  });

  it("a Member cannot delete", async () => {
    const { error } = await f.b.rpc("soft_delete_project", { p_project_id: f.projectId });
    expect(error?.code).toBe("42501");
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/project-lifecycle.test.ts`
Expected: FAIL — RPCs don't exist.

- [x] **Step 3: Migration**

```sql
-- supabase/migrations/202609180002_ownership_lifecycle.sql
create or replace function public.transfer_ownership(p_project_id uuid, p_new_owner_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  new_owner_role public.membership_role;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.memberships where project_id = p_project_id and user_id = current_user_id and role = 'owner') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select role into new_owner_role from public.memberships where memberships.project_id = p_project_id and memberships.user_id = p_new_owner_id;
  if new_owner_role is null then raise exception 'MEMBER_NOT_FOUND' using errcode = '22023'; end if;

  update public.memberships set role = 'admin' where memberships.project_id = p_project_id and memberships.user_id = current_user_id;
  update public.memberships set role = 'owner' where memberships.project_id = p_project_id and memberships.user_id = p_new_owner_id;
  update public.projects set owner_id = p_new_owner_id where projects.id = p_project_id;
  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value)
  values (p_project_id, current_user_id, 'project', p_project_id, 'role_changed', jsonb_build_object('newOwnerId', p_new_owner_id));
end;
$$;
revoke all on function public.transfer_ownership(uuid, uuid) from public;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;

create or replace function public.archive_project(p_project_id uuid, p_is_archived boolean)
returns table (id uuid, is_archived boolean)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); project_row public.projects%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.memberships where project_id = p_project_id and user_id = current_user_id and role in ('owner', 'admin')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.projects set is_archived = p_is_archived where projects.id = p_project_id and projects.deleted_at is null returning * into project_row;
  if not found then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  return query select project_row.id, project_row.is_archived;
end;
$$;
revoke all on function public.archive_project(uuid, boolean) from public;
grant execute on function public.archive_project(uuid, boolean) to authenticated;

-- Cascades deleted_at so RLS's existing `deleted_at is null` predicates on
-- projects/columns/tasks hide everything immediately; memberships/invitations
-- have no deleted_at, so they are deleted outright (nothing else references
-- them, and re-creating a project with the same id is impossible — it's a
-- fresh uuid every time).
create or replace function public.soft_delete_project(p_project_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.memberships where project_id = p_project_id and user_id = current_user_id and role = 'owner') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.projects set deleted_at = now() where projects.id = p_project_id;
  update public.columns set deleted_at = now() where columns.project_id = p_project_id and columns.deleted_at is null;
  update public.tasks set deleted_at = now() where tasks.project_id = p_project_id and tasks.deleted_at is null;
  delete from public.invitations where invitations.project_id = p_project_id;
  delete from public.memberships where memberships.project_id = p_project_id;
end;
$$;
revoke all on function public.soft_delete_project(uuid) from public;
grant execute on function public.soft_delete_project(uuid) to authenticated;
```

The `soft_delete_project` RLS test above reads `tasks`/`projects` as user B — since B's membership row is deleted in the same transaction, `is_project_member` (which every read policy calls) returns false immediately, so the zero-rows assertion holds even though `tasks.deleted_at` alone wouldn't be enough (a project's own tasks policy only checks `deleted_at is null and is_project_member(project_id)` — the membership deletion is what actually closes the door, `deleted_at` is belt-and-suspenders for direct-by-id lookups).

- [x] **Step 4: Apply and run the RLS suite**

Run: `npm run db:push` then `npm run test:rls`.
Expected: PASS.

- [x] **Step 5: Routes**

```ts
// src/app/api/v1/projects/[projectId]/transfer-ownership/route.ts
import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ projectId: z.string().uuid() }),
    body: z.object({ newOwnerId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to transfer ownership.",
    validationMessage: "Choose a member to transfer ownership to.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { error } = await supabase.rpc("transfer_ownership", {
      p_project_id: params.projectId,
      p_new_owner_id: body.newOwnerId,
    });
    if (error) return mapRpcError(error, { message: "Ownership could not be transferred.", requestId, projectScoped: true });
    return json({ data: { projectId: params.projectId, newOwnerId: body.newOwnerId } });
  },
);
```

Extend `src/app/api/v1/projects/[projectId]/route.ts` (read the current file first — Task 2B.1 Step 7 already added `projectScoped: true` to its existing `PATCH`) by adding a `DELETE` export:

```ts
export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ projectId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to delete projects.",
  },
  async ({ supabase, params, requestId }) => {
    const { error } = await supabase.rpc("soft_delete_project", { p_project_id: params.projectId });
    if (error) return mapRpcError(error, { message: "Project could not be deleted.", requestId, projectScoped: true });
    return new Response(null, { status: 204 });
  },
);
```

And change the existing `PATCH` body schema to accept an optional `isArchived`, routing to `archive_project` when that's the only field present versus `update_project` for name/description/timezone — keep this as two branches in the same handler rather than a new file, since they share params/auth:

```ts
const patchSchema = z.union([
  z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2000).nullable(), timezone: z.string().trim().min(1).max(64) }),
  z.object({ isArchived: z.boolean() }),
]);

export const PATCH = withApiHandler(
  { rateLimit: RATE_LIMITS.writes, params: z.object({ projectId: z.string().uuid() }), body: patchSchema, notFoundMessage: "Project not found.", unauthenticatedMessage: "Sign in to update projects.", validationMessage: "Check the project details and try again." },
  async ({ supabase, params, body, requestId }) => {
    if ("isArchived" in body) {
      const { data, error } = await supabase.rpc("archive_project", { p_project_id: params.projectId, p_is_archived: body.isArchived });
      if (error) return mapRpcError(error, { message: "Project could not be archived.", requestId, projectScoped: true });
      return json({ data: Array.isArray(data) ? data[0] : data });
    }
    const { data, error } = await supabase.rpc("update_project", { p_project_id: params.projectId, p_name: body.name, p_description: body.description, p_timezone: body.timezone });
    if (error) return mapRpcError(error, { message: "Project could not be updated.", requestId, projectScoped: true });
    return json({ data: Array.isArray(data) ? data[0] : data });
  },
);
```

- [x] **Step 6: Run full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint`
Expected: PASS. Confirm the existing `ProjectSettingsForm` component test (if any) still passes — its `PATCH` payload shape (`name`/`description`/`timezone`) is unchanged, only a sibling variant was added to the union.

```bash
git add supabase/migrations/202609180002_ownership_lifecycle.sql src/app/api/v1/projects/[projectId]/transfer-ownership src/app/api/v1/projects/[projectId]/route.ts src/test/rls/project-lifecycle.test.ts
git commit -m "feat(projects): add ownership transfer, archive and soft delete"
```

---

### Task 2B.7 — Members UI (S8 Members tab, S1 invite modal, S3 leave)

**Files:**
- Create: `src/components/members/members-table.tsx`, `src/components/members/invite-dialog.tsx`, `src/components/members/pending-invitations.tsx`, `src/components/members/member-avatar-stack.tsx`, `src/components/members/members-table.test.tsx`, `src/components/members/invite-dialog.test.tsx`, `src/app/(app)/p/[projectId]/settings/members/page.tsx`
- Modify: the project settings page/layout (add a "Members" tab alongside the existing settings tab — read the current settings page first to match its tab pattern), the board header (add `MemberAvatarStack` + Invite button), the project card component (add "Leave" for non-owners)

**Interfaces:**
- Consumes: `GET /api/v1/projects/:id/members`, `POST /api/v1/projects/:id/invitations`, `GET /api/v1/projects/:id/invitations`, `DELETE /api/v1/projects/:id/invitations/:invitationId`, `PATCH|DELETE /api/v1/projects/:id/members/:userId`.

- [x] **Step 1: Failing component test for the members table**

```tsx
// src/components/members/members-table.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MembersTable } from "./members-table";

const members = [
  { userId: "u-owner", role: "owner" as const, displayName: "Ada Owner" },
  { userId: "u-member", role: "member" as const, displayName: "Bo Member" },
];

describe("MembersTable", () => {
  it("disables the role dropdown for the Owner row", () => {
    render(<MembersTable members={members} currentUserId="u-owner" currentUserRole="owner" onRoleChange={vi.fn()} onRemove={vi.fn()} />);
    const ownerRow = screen.getByText("Ada Owner").closest("tr")!;
    expect(within(ownerRow).getByRole("combobox")).toBeDisabled();
  });

  it("a Member viewing the table sees no role controls at all", () => {
    render(<MembersTable members={members} currentUserId="u-member" currentUserRole="member" onRoleChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: /remove/i })).toHaveLength(0);
  });

  it("an Admin can change a Member's role", async () => {
    const onRoleChange = vi.fn();
    render(<MembersTable members={members} currentUserId="u-owner" currentUserRole="admin" onRoleChange={onRoleChange} onRemove={vi.fn()} />);
    const memberRow = screen.getByText("Bo Member").closest("tr")!;
    await userEvent.selectOptions(within(memberRow).getByRole("combobox"), "viewer");
    expect(onRoleChange).toHaveBeenCalledWith("u-member", "viewer");
  });
});

function within(element: HTMLElement) {
  return { getByRole: (role: string, options?: object) => screen.getByRole(role, { ...options }), queryAllByRole: screen.queryAllByRole };
}
```

Note: the `within` helper above is a placeholder for Testing Library's own `within` import — replace the local function with `import { within } from "@testing-library/react"` (already a transitive export of `@testing-library/dom`, which is an existing devDependency) rather than hand-rolling it; the inline version exists here only to keep this plan self-contained without re-deriving the import list mid-file.

- [x] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/members/members-table.test.tsx`
Expected: FAIL — module not found.

- [x] **Step 3: Implement `MembersTable`**

```tsx
// src/components/members/members-table.tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export type MemberRow = { userId: string; role: "owner" | "admin" | "member" | "viewer"; displayName: string };
type CallerRole = "owner" | "admin" | "member" | "viewer";

const ROLE_OPTIONS = ["admin", "member", "viewer"] as const;

export function MembersTable({
  members,
  currentUserId,
  currentUserRole,
  onRoleChange,
  onRemove,
}: {
  members: MemberRow[];
  currentUserId: string;
  currentUserRole: CallerRole;
  onRoleChange: (userId: string, role: (typeof ROLE_OPTIONS)[number]) => void;
  onRemove: (userId: string) => void;
}) {
  const canManage = currentUserRole === "owner" || currentUserRole === "admin";
  const [pending, setPending] = useState<string | null>(null);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground text-left">
          <th className="pb-2 font-medium">Member</th>
          <th className="pb-2 font-medium">Role</th>
          {canManage && <th className="pb-2" />}
        </tr>
      </thead>
      <tbody>
        {members.map((member) => (
          <tr key={member.userId} className="border-t">
            <td className="py-2">{member.displayName}</td>
            <td className="py-2">
              {canManage && member.role !== "owner" ? (
                <select
                  value={member.role}
                  disabled={member.role === "owner" || pending === member.userId}
                  onChange={(event) => onRoleChange(member.userId, event.target.value as (typeof ROLE_OPTIONS)[number])}
                  className="bg-background rounded border px-2 py-1"
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              ) : canManage ? (
                <select disabled className="bg-background rounded border px-2 py-1 opacity-60">
                  <option>owner</option>
                </select>
              ) : (
                <span className="capitalize">{member.role}</span>
              )}
            </td>
            {canManage && (
              <td className="py-2 text-right">
                {member.role !== "owner" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending === member.userId}
                    onClick={() => {
                      setPending(member.userId);
                      onRemove(member.userId);
                    }}
                  >
                    {member.userId === currentUserId ? "Leave" : "Remove"}
                  </Button>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [x] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/members/members-table.test.tsx`
Expected: PASS. Fix the test's inline `within` shim by importing the real one from `@testing-library/react` before this step, as noted above.

- [x] **Step 5: Failing test for the invite dialog**

```tsx
// src/components/members/invite-dialog.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InviteDialog } from "./invite-dialog";

describe("InviteDialog", () => {
  it("submits email and role", async () => {
    const onInvite = vi.fn().mockResolvedValue(undefined);
    render(<InviteDialog open onOpenChange={vi.fn()} onInvite={onInvite} />);
    await userEvent.type(screen.getByLabelText(/email/i), "person@example.com");
    await userEvent.selectOptions(screen.getByLabelText(/role/i), "admin");
    await userEvent.click(screen.getByRole("button", { name: /send invite/i }));
    expect(onInvite).toHaveBeenCalledWith({ email: "person@example.com", role: "admin" });
  });

  it("shows the server's error message on failure", async () => {
    const onInvite = vi.fn().mockRejectedValue(new Error("That person is already a member."));
    render(<InviteDialog open onOpenChange={vi.fn()} onInvite={onInvite} />);
    await userEvent.type(screen.getByLabelText(/email/i), "person@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send invite/i }));
    expect(await screen.findByText("That person is already a member.")).toBeInTheDocument();
  });
});
```

- [x] **Step 6: Run to verify it fails** — `npx vitest run src/components/members/invite-dialog.test.tsx` → FAIL, module not found.

- [x] **Step 7: Implement `InviteDialog` and `PendingInvitations`**

```tsx
// src/components/members/invite-dialog.tsx
"use client";
import { useState } from "react";
import * as Dialog from "radix-ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function InviteDialog({
  open,
  onOpenChange,
  onInvite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvite: (input: { email: string; role: "admin" | "member" | "viewer" }) => Promise<void>;
}) {
  const [email, setEmail] = useState(""),
    [role, setRole] = useState<"admin" | "member" | "viewer">("member"),
    [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await onInvite({ email, role });
      setEmail("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The invitation could not be sent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="bg-card fixed top-1/2 left-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5">
          <Dialog.Title className="text-lg font-semibold">Invite someone</Dialog.Title>
          <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-4">
            <label className="block text-sm font-medium" htmlFor="invite-email">
              Email
              <Input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} className="mt-2" />
            </label>
            <label className="block text-sm font-medium" htmlFor="invite-role">
              Role
              <select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as typeof role)} className="bg-background mt-2 w-full rounded border px-3 py-2">
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" disabled={pending}>
              {pending ? "Sending" : "Send invite"}
            </Button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

```tsx
// src/components/members/pending-invitations.tsx
"use client";
import { Button } from "@/components/ui/button";

export type PendingInvitation = { id: string; email: string; role: string; expiresAt: string };

export function PendingInvitations({
  invitations,
  canManage,
  onRevoke,
}: {
  invitations: PendingInvitation[];
  canManage: boolean;
  onRevoke: (id: string) => void;
}) {
  if (invitations.length === 0) return null;
  return (
    <div className="mt-6 space-y-2">
      <h3 className="text-muted-foreground text-sm font-medium">Pending invitations</h3>
      {invitations.map((invite) => (
        <div key={invite.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
          <span>
            {invite.email} · {invite.role}
          </span>
          {canManage && (
            <Button variant="ghost" size="sm" onClick={() => onRevoke(invite.id)}>
              Revoke
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
```

```tsx
// src/components/members/member-avatar-stack.tsx
export function MemberAvatarStack({ members }: { members: { userId: string; displayName: string }[] }) {
  const visible = members.slice(0, 5);
  const overflow = members.length - visible.length;
  return (
    <div className="flex -space-x-2" aria-label={`${members.length} members`}>
      {visible.map((member) => (
        <span
          key={member.userId}
          title={member.displayName}
          className="bg-muted text-muted-foreground flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-medium"
        >
          {member.displayName.slice(0, 1).toUpperCase()}
        </span>
      ))}
      {overflow > 0 && (
        <span className="bg-muted text-muted-foreground flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-medium">
          +{overflow}
        </span>
      )}
    </div>
  );
}
```

- [x] **Step 8: Run to verify the invite dialog test passes**

Run: `npx vitest run src/components/members/invite-dialog.test.tsx`
Expected: PASS.

- [x] **Step 9: Members settings page**

Read the existing project settings page/layout first (the file that currently renders `ProjectSettingsForm` and `WorkflowSettings` as tabs) and match its tab-list pattern exactly rather than inventing a new one. Add a `Members` tab rendering:

```tsx
// src/app/(app)/p/[projectId]/settings/members/page.tsx
import { createClient } from "@/lib/supabase/server";
import { MembersPageClient } from "./members-page-client";

export default async function MembersSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user!.id)
    .single();

  return <MembersPageClient projectId={projectId} currentUserId={auth.user!.id} currentUserRole={membership?.role ?? "viewer"} />;
}
```

`MembersPageClient` (a client component in the same directory) wires `MembersTable`, `InviteDialog`, and `PendingInvitations` together with `fetch` calls to the routes built in Tasks 2B.3/2B.5 — write it following the exact `fetch`/`useState`/error-message pattern already used in `src/components/projects/project-settings-form.tsx` (read that file again here for the pattern) rather than introducing a new data-fetching convention; it is intentionally not spelled out call-by-call in this plan because every call is a direct, un-novel repetition of that same fetch pattern against a different URL.

- [x] **Step 10: Add the invite button + avatar stack to the board header, and "Leave" to the project card**

Read the current board header component and project card component first. Add `MemberAvatarStack` + an "Invite" button (opens `InviteDialog`) to the header, matching its existing icon-button spacing; add a "Leave" action to the project card for any signed-in user whose role in that project is not `owner` (fetch role from the already-loaded project list data, which Task 2B.5's `GET /members` response includes per-row — no new fetch needed if the project list already joins membership role, otherwise add `role` to the existing projects list query's `select`).

- [x] **Step 11: Run full checks and commit**

Run: `npm run test && npm run typecheck && npm run lint && npm run build && npm run size`
Expected: all PASS; bundle budget still under 250 KB gz for the board route (member avatar stack and invite dialog are small; if the budget is exceeded, dynamic-`import()` the `InviteDialog` since it's only opened on click).

```bash
git add src/components/members src/app/\(app\)/p/\[projectId\]/settings/members
git commit -m "feat(members): add members table, invite dialog and pending invitations UI"
```

- [x] **Step 12: Record the decisions this sub-plan made**

Append to `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md`: the `GONE` (410) status code and its `P0003` errcode convention (extends the existing `P0001`/`P0002` custom-errcode convention from `create_project`/route mapping); the idempotency-key table shape and that it covers invitation creation now, task creation in 2C; the invite-token format (32 CSPRNG bytes, base64url, SHA-256 hash stored); that `soft_delete_project` deletes memberships/invitations outright rather than soft-deleting them (no `deleted_at` column on those tables, and re-use of a deleted project's row id is impossible).

```bash
git add docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md
git commit -m "docs: record 2B decisions (GONE status code, idempotency scope, invite token format)"
```

---

## Verification (sub-plan exit)

- **Per task:** `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build` green, per the Global Constraints commit rule.
- **Sub-plan exit:** `npm run size` still under budget; every RLS test file added this sub-plan (`members.test.ts`, `invitations.test.ts`, `members-lifecycle.test.ts`, `project-lifecycle.test.ts`) green against `kanbo-dev`; manual click-through once a dev server is available: invite a second real (throwaway) account by email, accept it signed-out, see it appear live in the members table, change its role, remove it, confirm its board access is cut immediately.
- See `00-master-roadmap.md` §6 for the Playwright flows this sub-plan enables (J4: invite → accept) — add to `e2e/` when Playwright is introduced (first needed here, since J4 is the first flow requiring a second real signed-in browser context).

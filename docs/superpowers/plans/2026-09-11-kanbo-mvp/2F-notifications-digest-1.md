# Kanbo Sub-plan 2F — Notifications, email & digest (P1) — Part 1 (Tasks 2F.1–2F.4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This file covers **Task 2F.1 through Task 2F.4** (the schema, the cron transport, the flush job, and the due-soon scan — everything that has to exist before there is a notification centre UI to look at). Part 2 (`2F-notifications-digest-2.md`) covers Tasks 2F.5–2F.7 (UI, weekly digest, Resend adapter) and builds directly on the tables and RPCs created here.

**Read first:**
- `00-master-roadmap.md` §2 Gap Register — **G1** (implicit watchers), **G2** (per-project digest), **G3** (project-timezone due state), **G12** (unsubscribe token), **G13** (`email_undeliverable_at`), **G14** (deep links), **T1** (pg_cron/pg_net cron architecture — binding on every task in this file).
- `00-master-roadmap.md` §4 Cross-cutting rules — every RPC/RLS/commit convention below is inherited from there, not repeated in full.
- `2B-members-invitations.md` **Global Constraints** section — the ambiguous-column bug and the RPC shape (`auth.uid()` null check → membership/role check → validation → mutation + `activity`/`notifications` insert in one transaction → `revoke all … from public` + explicit `grant execute`). Every migration in this file follows that shape.
- `src/lib/email/sender.ts`, `console-sender.ts`, `index.ts`, `templates/invitation.ts` — the `EmailSender` interface and template shape this phase's `flush.ts` and digest builder reuse verbatim.
- `src/lib/api/handler.ts` (`withApiHandler`, `mapRpcError`, the existing `P0003` → `GONE` (410) mapping), `src/lib/api/response.ts` (`ApiErrorCode`), `src/lib/api/rate-limit.ts` (`RATE_LIMITS`, `consume_rate_limit` RPC), `src/test/rls/setup.ts` (`seedIsolationFixture`), `src/lib/log.ts` (`REDACTED_KEYS`), `src/lib/supabase/admin.ts` (`createAdminClient`) — every task below consumes these.
- `supabase/migrations/202609090001_data_core.sql` — current schema: `activity_action` enum (no `commented` yet — that lands in 2D, out of scope here), `users.timezone`, `projects.timezone`, `is_project_member`/`can_write_project` helpers, `membership_role_rank` (added in 2B.3).

**Spec:** `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md` + `docs/specs/00`–`07`; `00-master-roadmap.md` §5 Sub-plan 2F.

**Definition of done (this file):** Tasks 2F.1–2F.4 acceptance tests green; `notifications`, `notification_queue`, `notification_preferences`, `job_runs` covered by the RLS isolation suite; `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build` green; migrations applied to `kanbo-dev` and reproven with `npm run test:rls`.

---

## Global Constraints (binding on every task in this file, and repeated in Part 2)

- **The ambiguous-column bug.** Any `security definer` plpgsql function that `returns table (id uuid, ...)` (or any OUT-parameter name that is also a column name — `role`, `type`, `status`, `email`) creates a same-named variable in scope for the whole function body. An unqualified reference inside that body is ambiguous between the OUT parameter and the table column and Postgres raises `column reference "X" is ambiguous`. This broke `create_task`, `move_task`, `update_task` and others in production; fixed in `202609150001_fix_ambiguous_id_refs.sql`. **Every RPC below that returns a table with a column named `id`, `role`, `type`, `user_id`, or `status` must qualify every bare reference to that name with its table alias** (e.g. `n.id`, `nq.user_id`, `np.category`). This is invisible to unit tests (RPCs are mocked there) — `npm run test:rls` against a real Supabase project is the only thing that catches it, so every migration task below ends by running it for real.
- **T1 cron architecture (binding on 2F.2–2F.4 and, in Part 2, 2F.6):** all schedules run on `pg_cron` inside Supabase — no Vercel Cron (Hobby tier allows daily only). Jobs that do pure SQL work (no outbound email) are plpgsql functions scheduled directly with `cron.schedule(...)` — this is Task 2F.4 (due-soon scan). Jobs that must send email cannot run inside Postgres, so `pg_cron` triggers them indirectly: `cron.schedule` calls `net.http_post` (the `pg_net` extension) against `POST /api/cron/<job>` on the deployed app, with a `CRON_SECRET` bearer header — this is Task 2F.2 (plumbing) and Task 2F.3 (the flush job it triggers). Every job — SQL-only or HTTP-triggered — writes one row to `job_runs (job_name, run_key, started_at, finished_at, error)` with `unique(job_name, run_key)`, so a duplicate trigger (retried `pg_net` call, overlapping schedule tick) is a guaranteed no-op rather than a duplicate email or duplicate notification burst.
- TypeScript strict; no `any` in application code.
- No Docker locally. Apply migrations via `npm run db:push` against the linked project, or the Supabase MCP `apply_migration` tool against `kanbo-dev`; either way, run `npm run test:rls` against the same project afterward.
- Every migration file: `supabase/migrations/YYYYMMDDNNNN_<name>.sql`, forward-only — never edit an applied migration; ship a new one.
- Every new/changed RPC: `security definer`, `set search_path = public`, `revoke all … from public`, explicit `grant execute` to the minimum role that needs it. `enqueue_notifications` is deliberately granted to **no client role at all** (see Task 2F.1) — it is an internal fan-out helper called only from other `security definer` functions and from the due-soon-scan cron job, never from the browser or a route handler directly.
- Every new table: RLS enabled + forced, deny by default, explicit policies, added to `src/test/rls/notifications.test.ts` in the same task it lands in.
- Every project-scoped write: non-members get **404** (`mapRpcError(error, { projectScoped: true })`), never 403.
- Security-sensitive tasks (the cron endpoint in 2F.2, and in Part 2 the unsubscribe token) list security properties and have one test per property: no enumeration, rate limited where unauthenticated, explicit max lengths before hashing, generic error copy, single-use/idempotent by construction, and — new to this phase — **no timing leak on secret comparison**.
- `SUPABASE_SERVICE_ROLE_KEY` only via `createAdminClient()`, never inline. The cron route is one of the three callers this key is scoped to (`00-master-roadmap.md` §4).
- Structured JSON logs via `log()`; never log tokens, emails, notification payload bodies, or comment/task text above `debug`.
- Commit at the end of every task: Conventional Commits, **no `Co-Authored-By` or `Claude-Session` trailers**. Before each commit: `git status`, inspect the diff, no secrets, `npm run test`, `npm run typecheck`, `npm run lint`.

---

## File Structure (this file)

```
supabase/migrations/202609190001_notifications.sql          Task 2F.1 — notifications, notification_queue, notification_preferences, users.email_undeliverable_at, enqueue_notifications, RLS, publication
supabase/migrations/202609190002_notification_callers.sql   Task 2F.1 — wires enqueue_notifications into create_task/update_task (assignment), move_task (status change to watchers)
src/test/rls/notifications.test.ts                          Task 2F.1 (extended through 2F.4)
supabase/migrations/202609200001_cron_plumbing.sql          Task 2F.2 — pg_cron/pg_net extensions, job_runs table, notification-flush schedule
src/lib/cron/verify-secret.ts, verify-secret.test.ts         Task 2F.2 — constant-time CRON_SECRET compare
src/lib/cron/job-runs.ts, job-runs.test.ts                   Task 2F.2 — claimJobRun()/finishJobRun() helpers over job_runs
src/app/api/cron/[job]/route.ts, route.test.ts               Task 2F.2
src/lib/notifications/flush.ts, flush.test.ts                Task 2F.3
supabase/migrations/202609200002_due_soon_scan.sql           Task 2F.4 — hourly plpgsql job + partial unique index for idempotency
.env.example                                                  Task 2F.2 (modify — CRON_SECRET already listed by 2A.3; confirm present)
```

---

### Task 2F.1 — Notification tables + fan-out RPC

**Files:**
- Create: `supabase/migrations/202609190001_notifications.sql`, `supabase/migrations/202609190002_notification_callers.sql`, `src/test/rls/notifications.test.ts`

**Interfaces:**
- Produces:
  ```sql
  -- internal only — no grant to authenticated/anon (see Global Constraints)
  enqueue_notifications(
    p_type public.notification_type,
    p_project_id uuid,
    p_task_id uuid,
    p_actor_id uuid,
    p_recipient_ids uuid[],
    p_payload jsonb
  ) returns void
  ```
- Consumes: nothing new — reuses `is_project_member`/`can_write_project` (`202609090001`), `membership_role_rank` (`202609160004`).
- Schema:
  ```
  notifications (id, user_id, project_id, task_id, type, actor_id, payload jsonb, email_status text, read_at, created_at)
  notification_queue (id, user_id, window_start, send_after, sent_at, attempts, last_error, created_at) — one row per (user_id, 5-minute window)
  notification_preferences (user_id, category text, email boolean default true, primary key(user_id, category)) — opt-out model: no row = email enabled
  users.email_undeliverable_at timestamptz (G13)
  ```

**Security properties:** the acting user is never notified of their own action (no self-notify); a recipient who has muted the notification's category gets an in-app row but no queue entry; `notifications`/`notification_queue` have no client-writable policies at all — every row is written by `security definer` RPCs or the cron job, never by a direct client insert.

**Design note (batching):** rather than one `notification_queue` row per notification (which would need a join table to bundle N notifications into one email), each `notifications` row carries its own `email_status` (`'pending' | 'skipped' | 'sent'`), and `notification_queue` holds at most **one row per user per 5-minute window** (`unique(user_id, window_start)`, `on conflict do nothing`). `enqueue_notifications` always inserts a fresh `notifications` row per recipient (so 10 assignments → 10 in-app rows), but the queue upsert is a no-op after the first call in a window (so N notifications in one window share one queue row / one flush / one email — Task 2F.3 reads it this way).

- [ ] **Step 1: Write the failing SQL/RLS test**

```ts
// src/test/rls/notifications.test.ts
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

describe("notifications RLS", () => {
  it("a user reads only their own in-app notifications", async () => {
    const admin = createAdminClient();
    await admin.from("memberships").insert({ project_id: f.projectId, user_id: f.bId, role: "member" });
    await admin.rpc("enqueue_notifications", {
      p_type: "task_assigned",
      p_project_id: f.projectId,
      p_task_id: f.taskId,
      p_actor_id: f.aId,
      p_recipient_ids: [f.bId],
      p_payload: { taskTitle: "A's task" },
    });
    const { data: bRows, error: bErr } = await f.b.from("notifications").select("id, type, user_id");
    expect(bErr).toBeNull();
    expect(bRows).toHaveLength(1);
    expect(bRows?.[0].type).toBe("task_assigned");

    const { data: aRows } = await f.a.from("notifications").select("id").eq("user_id", f.bId);
    expect(aRows).toEqual([]); // A cannot read B's notifications
  });

  it("no client insert/update policy exists — direct writes are rejected", async () => {
    const { error } = await f.b.from("notifications").insert({
      user_id: f.bId,
      project_id: f.projectId,
      type: "task_assigned",
      payload: {},
    });
    expect(error).not.toBeNull();
  });

  it("notification_queue and notification_preferences deny all direct client access except preferences self-row", async () => {
    const { data: queueRows, error: queueErr } = await f.b.from("notification_queue").select("*");
    expect(queueErr).toBeNull();
    expect(queueRows).toEqual([]); // no select policy at all — RLS hides everything

    const { error: prefUpsertErr } = await f.b
      .from("notification_preferences")
      .upsert({ user_id: f.bId, category: "assignment", email: false });
    expect(prefUpsertErr).toBeNull(); // users may manage their own prefs directly

    const { error: prefOtherErr } = await f.b
      .from("notification_preferences")
      .upsert({ user_id: f.aId, category: "assignment", email: false });
    expect(prefOtherErr).not.toBeNull(); // but not someone else's
  });
});

describe("enqueue_notifications fan-out", () => {
  it("never notifies the actor, even if the actor is in the recipient list", async () => {
    const admin = createAdminClient();
    await admin.rpc("enqueue_notifications", {
      p_type: "status_changed",
      p_project_id: f.projectId,
      p_task_id: f.taskId,
      p_actor_id: f.aId,
      p_recipient_ids: [f.aId, f.bId],
      p_payload: { toColumn: "Done" },
    });
    const { data } = await admin
      .from("notifications")
      .select("user_id")
      .eq("task_id", f.taskId)
      .eq("type", "status_changed");
    expect(data?.map((r) => r.user_id)).toEqual([f.bId]);
  });

  it("skips the email queue for a muted category but still writes the in-app row", async () => {
    const admin = createAdminClient();
    await admin.from("notification_preferences").upsert({ user_id: f.bId, category: "mention", email: false });
    await admin.rpc("enqueue_notifications", {
      p_type: "mentioned",
      p_project_id: f.projectId,
      p_task_id: f.taskId,
      p_actor_id: f.aId,
      p_recipient_ids: [f.bId],
      p_payload: {},
    });
    const { data: notif } = await admin
      .from("notifications")
      .select("email_status")
      .eq("user_id", f.bId)
      .eq("type", "mentioned")
      .single();
    expect(notif?.email_status).toBe("skipped");
  });

  it("a burst of 10 assignments to the same user in the same window writes 10 in-app rows but one shared queue row", async () => {
    const admin = createAdminClient();
    for (let i = 0; i < 10; i++) {
      await admin.rpc("enqueue_notifications", {
        p_type: "task_assigned",
        p_project_id: f.projectId,
        p_task_id: f.taskId,
        p_actor_id: f.aId,
        p_recipient_ids: [f.bId],
        p_payload: { burst: i },
      });
    }
    const { data: notifs } = await admin
      .from("notifications")
      .select("id")
      .eq("user_id", f.bId)
      .eq("type", "task_assigned");
    expect(notifs?.length).toBeGreaterThanOrEqual(10);

    const { data: queueRows } = await admin
      .from("notification_queue")
      .select("id")
      .eq("user_id", f.bId);
    expect(queueRows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/notifications.test.ts`
Expected: FAIL — none of `notifications`, `notification_queue`, `notification_preferences`, or `enqueue_notifications` exist yet.

- [ ] **Step 3: Migration — tables, RLS, `enqueue_notifications`**

```sql
-- supabase/migrations/202609190001_notifications.sql
create type public.notification_type as enum (
  'task_assigned', 'task_unassigned', 'mentioned', 'status_changed', 'due_soon', 'digest_ready'
);
-- category is coarser than type — this is the granularity a user can mute at
-- (matches the unsubscribe-token scheme in 2F.5, one category per link).
create type public.notification_category as enum ('assignment', 'mention', 'status_change', 'due_soon', 'digest');

alter table public.users add column email_undeliverable_at timestamptz; -- G13, set by the Resend webhook in 2F.7

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  type public.notification_type not null,
  actor_id uuid references public.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  email_status text not null default 'pending' check (email_status in ('pending', 'skipped', 'sent')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_user_unread on public.notifications(user_id, created_at desc) where read_at is null;
create index idx_notifications_user_recent on public.notifications(user_id, created_at desc);
-- Idempotency for the due-soon scan (2F.4): never notify the same user for the
-- same task/type/due-date combination twice.
create unique index notifications_due_soon_once
  on public.notifications(task_id, type, user_id, (payload ->> 'dueDate'))
  where type = 'due_soon';

create table public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  window_start timestamptz not null,
  send_after timestamptz not null,
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  unique (user_id, window_start)
);
create index idx_notification_queue_due on public.notification_queue(send_after) where sent_at is null;

create table public.notification_preferences (
  user_id uuid not null references public.users(id) on delete cascade,
  category public.notification_category not null,
  email boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

alter table public.notifications enable row level security; alter table public.notifications force row level security;
alter table public.notification_queue enable row level security; alter table public.notification_queue force row level security;
alter table public.notification_preferences enable row level security; alter table public.notification_preferences force row level security;

create policy notifications_self_read on public.notifications for select using (user_id = auth.uid());
-- No insert/update/delete policy for notifications: every write goes through
-- enqueue_notifications (security definer) or mark_notification_read (2F.5),
-- both of which run as the function owner and bypass RLS.

-- notification_queue: no policies at all — service-role (the flush job) only.

create policy notification_preferences_self on public.notification_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter publication supabase_realtime add table public.notifications;

-- Maps a notification_type to the coarser category a user mutes at.
create or replace function public.notification_category_for(p_type public.notification_type)
returns public.notification_category language sql immutable as $$
  select case p_type
    when 'task_assigned' then 'assignment'::public.notification_category
    when 'task_unassigned' then 'assignment'::public.notification_category
    when 'mentioned' then 'mention'::public.notification_category
    when 'status_changed' then 'status_change'::public.notification_category
    when 'due_soon' then 'due_soon'::public.notification_category
    when 'digest_ready' then 'digest'::public.notification_category
  end;
$$;

-- Internal fan-out helper. Not granted to authenticated/anon (see Global
-- Constraints) — callable only from other security definer functions in this
-- schema (create_task/update_task/move_task below, and the due-soon-scan job
-- in 2F.4), which already re-validated project membership and role before
-- calling this. It trusts p_recipient_ids exactly as given; callers are
-- responsible for computing that set correctly (implicit watchers, G1).
create or replace function public.enqueue_notifications(
  p_type public.notification_type,
  p_project_id uuid,
  p_task_id uuid,
  p_actor_id uuid,
  p_recipient_ids uuid[],
  p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  recipient_id uuid;
  category public.notification_category := public.notification_category_for(p_type);
  email_allowed boolean;
  new_notification_id uuid;
  window_start timestamptz := date_trunc('hour', now())
    + (floor(extract(minute from now()) / 5) * interval '5 minutes');
begin
  if p_recipient_ids is null then return; end if;
  foreach recipient_id in array p_recipient_ids loop
    if recipient_id is null or recipient_id = p_actor_id then continue; end if; -- no self-notify

    select coalesce(np.email, true) into email_allowed
      from public.notification_preferences np
      where np.user_id = recipient_id and np.category = category;
    if not found then email_allowed := true; end if; -- opt-out model: no row = enabled

    if exists (select 1 from public.users u where u.id = recipient_id and u.email_undeliverable_at is not null) then
      email_allowed := false;
    end if;

    insert into public.notifications (user_id, project_id, task_id, type, actor_id, payload, email_status)
    values (recipient_id, p_project_id, p_task_id, p_type, p_actor_id, coalesce(p_payload, '{}'::jsonb),
      case when email_allowed then 'pending' else 'skipped' end)
    returning notifications.id into new_notification_id;

    if email_allowed then
      insert into public.notification_queue (user_id, window_start, send_after)
      values (recipient_id, window_start, window_start + interval '5 minutes')
      on conflict (user_id, window_start) do nothing;
    end if;
  end loop;
end;
$$;
revoke all on function public.enqueue_notifications(public.notification_type, uuid, uuid, uuid, uuid[], jsonb) from public;
-- Deliberately no grant to authenticated or anon — see docstring above.
```

- [ ] **Step 4: Migration — wire the fan-out into existing write RPCs**

```sql
-- supabase/migrations/202609190002_notification_callers.sql
-- Extends create_task/update_task (assignment) and move_task (status change
-- to implicit watchers, G1: creator + assignee + commenters — commenters
-- don't exist until 2D, so today the watcher set is {creator, assignee}).
-- Bodies are otherwise unchanged from 202609160001; only the notification
-- fan-out calls are new, added as the last statement before RETURN QUERY so
-- a fan-out failure still rolls back with the rest of the transaction.

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

  if p_assignee_id is not null and p_assignee_id <> current_user_id then
    perform public.enqueue_notifications('task_assigned', p_project_id, created_task.id, current_user_id,
      array[p_assignee_id], jsonb_build_object('taskTitle', created_task.title));
  end if;

  return query select created_task.id, created_task.column_id, created_task.title, created_task.description, created_task.due_date, created_task.priority, created_task.position, created_task.created_at, created_task.updated_at;
end;
$$;

create or replace function public.update_task(
  p_task_id uuid, p_title text, p_description text, p_due_date date, p_priority public.task_priority,
  p_assignee_id uuid default null, p_assignee_changed boolean default false
) returns table (
  id uuid, column_id uuid, title varchar, description text, due_date date, priority public.task_priority,
  "position" double precision, created_at timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_task public.tasks%rowtype;
  before_value jsonb;
  previous_assignee_id uuid;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_project_member(existing_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(existing_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 200 then raise exception 'INVALID_TASK_TITLE' using errcode = '22023'; end if;
  if p_description is not null and char_length(p_description) > 20000 then raise exception 'INVALID_DESCRIPTION' using errcode = '22023'; end if;
  if p_assignee_changed and p_assignee_id is not null and not exists (select 1 from public.memberships where project_id = existing_task.project_id and user_id = p_assignee_id) then
    raise exception 'INVALID_ASSIGNEE' using errcode = '22023';
  end if;
  previous_assignee_id := existing_task.assignee_id;
  before_value := jsonb_build_object('title', existing_task.title, 'description', existing_task.description, 'dueDate', existing_task.due_date, 'priority', existing_task.priority);

  update public.tasks set title = trim(p_title), description = nullif(trim(p_description), ''), due_date = p_due_date, priority = p_priority,
    assignee_id = case when p_assignee_changed then p_assignee_id else assignee_id end
    where tasks.id = p_task_id returning * into existing_task;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value, to_value)
  values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id, 'updated', before_value,
    jsonb_build_object('title', existing_task.title, 'description', existing_task.description, 'dueDate', existing_task.due_date, 'priority', existing_task.priority));

  if p_assignee_changed and existing_task.assignee_id is distinct from previous_assignee_id then
    if existing_task.assignee_id is not null and existing_task.assignee_id <> current_user_id then
      perform public.enqueue_notifications('task_assigned', existing_task.project_id, existing_task.id, current_user_id,
        array[existing_task.assignee_id], jsonb_build_object('taskTitle', existing_task.title));
    end if;
    if previous_assignee_id is not null and previous_assignee_id <> current_user_id and previous_assignee_id is distinct from existing_task.assignee_id then
      perform public.enqueue_notifications('task_unassigned', existing_task.project_id, existing_task.id, current_user_id,
        array[previous_assignee_id], jsonb_build_object('taskTitle', existing_task.title));
    end if;
  end if;

  return query select existing_task.id, existing_task.column_id, existing_task.title, existing_task.description, existing_task.due_date, existing_task.priority, existing_task.position, existing_task.created_at, existing_task.updated_at;
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
  watcher_ids uuid[];
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

  if activity_kind in ('moved', 'completed', 'reopened') then
    -- Implicit watchers (G1): creator + assignee. Commenters join this set in 2D.
    select array_remove(array_agg(distinct w), current_user_id) into watcher_ids
      from unnest(array[existing_task.created_by, existing_task.assignee_id]) as w
      where w is not null;
    if watcher_ids is not null and array_length(watcher_ids, 1) > 0 then
      perform public.enqueue_notifications('status_changed', existing_task.project_id, existing_task.id, current_user_id,
        watcher_ids, jsonb_build_object('taskTitle', existing_task.title, 'action', activity_kind));
    end if;
  end if;

  return query select existing_task.id, existing_task.column_id, existing_task.position, existing_task.updated_at;
end;
$$;
```

> **Judgment call:** `update_task`'s signature grows two optional parameters (`p_assignee_id`, `p_assignee_changed`) rather than a bare `p_assignee_id uuid` that can't distinguish "leave unchanged" from "clear the assignee." This mirrors the pattern `2C.3` (board completion) already plans to add for the assignee picker; if `2C.3` ships first with a different signature, reconcile by keeping `2C.3`'s signature and moving only the `enqueue_notifications` calls here into it.

- [ ] **Step 5: Apply migrations and run the RLS suite**

Run: `npm run db:push` (or MCP `apply_migration`), then `npm run test:rls -- src/test/rls/notifications.test.ts src/test/rls/isolation.test.ts`.
Expected: PASS — including the pre-existing `isolation.test.ts` (the `create_task`/`update_task`/`move_task` bodies changed but their existing error-path assertions are untouched).

- [ ] **Step 6: Run full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint`

```bash
git add supabase/migrations/202609190001_notifications.sql supabase/migrations/202609190002_notification_callers.sql src/test/rls/notifications.test.ts
git commit -m "feat(notifications): add notification tables and enqueue_notifications fan-out"
```

---

### Task 2F.2 — Cron plumbing (T1)

**Files:**
- Create: `supabase/migrations/202609200001_cron_plumbing.sql`, `src/lib/cron/verify-secret.ts`, `src/lib/cron/verify-secret.test.ts`, `src/lib/cron/job-runs.ts`, `src/lib/cron/job-runs.test.ts`, `src/app/api/cron/[job]/route.ts`, `src/app/api/cron/[job]/route.test.ts`
- Modify: `.env.example` (confirm `CRON_SECRET` is present — it was added in 2A.3's `.env.example` change; if absent, add it)

**Interfaces:**
- Produces:
  ```ts
  // src/lib/cron/verify-secret.ts
  export function verifyCronSecret(provided: string | null, expected: string): boolean;
  // src/lib/cron/job-runs.ts
  export async function claimJobRun(jobName: string, runKey: string): Promise<{ claimed: boolean }>;
  export async function finishJobRun(jobName: string, runKey: string, error?: string): Promise<void>;
  ```
- Consumes: `createAdminClient` (`src/lib/supabase/admin.ts`), `log` (`src/lib/log.ts`).

**Security properties:** missing or wrong `CRON_SECRET` → 401 with generic body, verified via a fixed-length digest comparison so response time does not vary with how many leading bytes of the guess are correct (no timing leak); the route is idempotent per `(job, run_key)` — a duplicate `pg_net` delivery (retried webhook, overlapping schedule tick) claims no row and returns 200 with `{ "duplicate": true }` rather than re-running the job body; `CRON_SECRET` is read only from `process.env` inside the route handler, never logged, never echoed in a response.

- [ ] **Step 1: Write the failing tests for the secret comparison**

```ts
// src/lib/cron/verify-secret.test.ts
import { describe, expect, it, vi } from "vitest";
import * as crypto from "node:crypto";
import { verifyCronSecret } from "./verify-secret";

describe("verifyCronSecret", () => {
  it("returns true for a matching secret", () => {
    expect(verifyCronSecret("correct-horse-battery-staple", "correct-horse-battery-staple")).toBe(true);
  });

  it("returns false for a wrong secret, even one of a different length", () => {
    expect(verifyCronSecret("x", "correct-horse-battery-staple")).toBe(false);
    expect(verifyCronSecret("correct-horse-battery-staple-but-longer", "correct-horse-battery-staple")).toBe(false);
  });

  it("returns false for a null/missing provided value", () => {
    expect(verifyCronSecret(null, "correct-horse-battery-staple")).toBe(false);
  });

  it("always hashes both sides before comparing, so no length-based short-circuit exists (no timing leak)", () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    verifyCronSecret("short", "a-much-longer-expected-secret-value");
    expect(spy).toHaveBeenCalledTimes(1);
    const [a, b] = spy.mock.calls[0] as [Buffer, Buffer];
    // Both operands must be equal-length (both are sha256 digests, 32 bytes)
    // regardless of the original strings' lengths — this is what makes the
    // comparison constant-time: crypto.timingSafeEqual itself throws on
    // mismatched lengths, so if callers ever passed raw strings of differing
    // length, the function would need a length branch, which is exactly the
    // timing leak this hashing step avoids.
    expect(a.length).toBe(32);
    expect(b.length).toBe(32);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/cron/verify-secret.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/cron/verify-secret.ts
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time secret comparison. Both inputs are first reduced to a
 * fixed-length SHA-256 digest so that `timingSafeEqual` — which itself
 * requires equal-length buffers and would otherwise force a length check
 * (and therefore an early, timing-observable return) before it could even
 * be called — never needs a length branch at all. A guess of the wrong
 * length costs exactly the same wall-clock time as a guess of the right
 * length with the wrong bytes.
 */
export function verifyCronSecret(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/cron/verify-secret.test.ts` → PASS.

- [ ] **Step 5: Write the failing tests for `job-runs`**

```ts
// src/lib/cron/job-runs.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimJobRun, finishJobRun } from "./job-runs";

const insert = vi.fn();
const update = vi.fn();
const eqChain = () => ({ eq: eqChain, then: undefined });
const from = vi.fn((table: string) => ({
  insert,
  update: (patch: unknown) => {
    update(patch);
    return { eq: () => ({ eq: async () => ({ error: null }) }) };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));

describe("claimJobRun", () => {
  beforeEach(() => insert.mockReset());

  it("claims the row on first insert", async () => {
    insert.mockResolvedValue({ error: null });
    const result = await claimJobRun("notification-flush", "202609200910");
    expect(result.claimed).toBe(true);
    expect(insert).toHaveBeenCalledWith({ job_name: "notification-flush", run_key: "202609200910" });
  });

  it("does not claim on a unique-violation (23505) — duplicate trigger", async () => {
    insert.mockResolvedValue({ error: { code: "23505" } });
    const result = await claimJobRun("notification-flush", "202609200910");
    expect(result.claimed).toBe(false);
  });
});

describe("finishJobRun", () => {
  it("records finished_at and an optional error", async () => {
    await finishJobRun("notification-flush", "202609200910", "boom");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ error: "boom" }));
  });
});
```

- [ ] **Step 6: Run to verify it fails** — `npx vitest run src/lib/cron/job-runs.test.ts` → FAIL, module missing.

- [ ] **Step 7: Migration — extensions, `job_runs`, the flush schedule**

```sql
-- supabase/migrations/202609200001_cron_plumbing.sql
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

-- Idempotency ledger shared by every scheduled job (T1). Service-role only —
-- no client policies at all.
create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null check (char_length(job_name) <= 100),
  run_key text not null check (char_length(run_key) <= 100),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  unique (job_name, run_key)
);
alter table public.job_runs enable row level security; alter table public.job_runs force row level security;

-- pg_net needs the site URL and the shared secret at schedule time. Both are
-- stored in Supabase Vault (never inline in a migration file, since the
-- secret value must not be committed) and read back with a subquery. An
-- OPERATOR STEP (see below) creates these two secrets once per environment
-- before this schedule can actually fire successfully; until then the cron
-- tick will 401 against the route, which is safe (job_runs stays unclaimed).
select cron.schedule(
  'notification-flush',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_site_url') || '/api/cron/notification-flush',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'run_key', to_char(date_trunc('hour', now()) + (floor(extract(minute from now()) / 5) * interval '5 minutes'), 'YYYYMMDDHH24MI')
    )
  );
  $$
);
```

**Operator step (interactive, once per environment — record in `docs/runbook.md`):**
```sql
select vault.create_secret('https://kanbo-staging.vercel.app', 'cron_site_url');
select vault.create_secret('<the same value as the CRON_SECRET env var on Vercel>', 'cron_secret');
```
Repeat with the production URL/secret on `kanbo-prod`. If the `CRON_SECRET` env var is ever rotated, update the vault secret in the same change (`select vault.update_secret(...)`) so the schedule and the route agree.

- [ ] **Step 8: Implement `job-runs.ts`**

```ts
// src/lib/cron/job-runs.ts
import { createAdminClient } from "@/lib/supabase/admin";

export async function claimJobRun(jobName: string, runKey: string): Promise<{ claimed: boolean }> {
  const admin = createAdminClient();
  const { error } = await admin.from("job_runs").insert({ job_name: jobName, run_key: runKey });
  if (error?.code === "23505") return { claimed: false }; // duplicate trigger — already running or done
  if (error) throw error;
  return { claimed: true };
}

export async function finishJobRun(jobName: string, runKey: string, error?: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("job_runs")
    .update({ finished_at: new Date().toISOString(), error: error ?? null })
    .eq("job_name", jobName)
    .eq("run_key", runKey);
}
```

- [ ] **Step 9: Apply the migration and run to verify `job-runs.test.ts` passes**

Run: `npm run db:push` (or MCP `apply_migration`), then `npx vitest run src/lib/cron/job-runs.test.ts` → PASS.

- [ ] **Step 10: Write the failing route test**

```ts
// src/app/api/cron/[job]/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const claimJobRun = vi.fn();
const finishJobRun = vi.fn();
vi.mock("@/lib/cron/job-runs", () => ({ claimJobRun, finishJobRun }));
const flushNotificationQueue = vi.fn();
vi.mock("@/lib/notifications/flush", () => ({ flushNotificationQueue }));

const ORIGINAL_SECRET = process.env.CRON_SECRET;
beforeEach(() => {
  process.env.CRON_SECRET = "test-cron-secret";
  claimJobRun.mockReset().mockResolvedValue({ claimed: true });
  finishJobRun.mockReset();
  flushNotificationQueue.mockReset().mockResolvedValue({ sent: 0 });
});

import { POST } from "./route";

function req(body: unknown, auth?: string) {
  return new Request("http://localhost/api/cron/notification-flush", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
}

describe("POST /api/cron/[job]", () => {
  it("401s with no leaked detail when the secret is missing", async () => {
    const res = await POST(req({ run_key: "k1" }) as never, { params: Promise.resolve({ job: "notification-flush" }) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).not.toContain("secret");
  });

  it("401s when the secret is wrong", async () => {
    const res = await POST(req({ run_key: "k1" }, "Bearer wrong") as never, {
      params: Promise.resolve({ job: "notification-flush" }),
    });
    expect(res.status).toBe(401);
  });

  it("404s for an unknown job name", async () => {
    const res = await POST(req({ run_key: "k1" }, "Bearer test-cron-secret") as never, {
      params: Promise.resolve({ job: "not-a-real-job" }),
    });
    expect(res.status).toBe(404);
  });

  it("runs the job and returns 200 on first delivery", async () => {
    const res = await POST(req({ run_key: "k1" }, "Bearer test-cron-secret") as never, {
      params: Promise.resolve({ job: "notification-flush" }),
    });
    expect(res.status).toBe(200);
    expect(flushNotificationQueue).toHaveBeenCalledTimes(1);
    expect(finishJobRun).toHaveBeenCalledWith("notification-flush", "k1", undefined);
  });

  it("is a no-op on a duplicate (job, run_key) delivery", async () => {
    claimJobRun.mockResolvedValue({ claimed: false });
    const res = await POST(req({ run_key: "k1" }, "Bearer test-cron-secret") as never, {
      params: Promise.resolve({ job: "notification-flush" }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(flushNotificationQueue).not.toHaveBeenCalled();
  });

  it("records the job as failed without leaking internal error detail in the response", async () => {
    flushNotificationQueue.mockRejectedValue(new Error("boom: db connection string leaked here"));
    const res = await POST(req({ run_key: "k1" }, "Bearer test-cron-secret") as never, {
      params: Promise.resolve({ job: "notification-flush" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("connection string");
    expect(finishJobRun).toHaveBeenCalledWith("notification-flush", "k1", "boom: db connection string leaked here");
  });
});
```

- [ ] **Step 11: Run to verify it fails** — `npx vitest run src/app/api/cron/\[job\]/route.test.ts` → FAIL, route missing.

- [ ] **Step 12: Implement the route**

```ts
// src/app/api/cron/[job]/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify-secret";
import { claimJobRun, finishJobRun } from "@/lib/cron/job-runs";
import { flushNotificationQueue } from "@/lib/notifications/flush";
import { runWeeklyDigest } from "@/lib/digest/build"; // added in 2F.6 — stubbed until then, see note below
import { log } from "@/lib/log";

type JobHandler = () => Promise<unknown>;

const JOBS: Record<string, JobHandler> = {
  "notification-flush": () => flushNotificationQueue(),
  "weekly-digest": () => runWeeklyDigest(),
};

export async function POST(request: NextRequest, context: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET ?? "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!secret || !verifyCronSecret(provided, secret)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Not found." } }, { status: 401 });
  }

  const { job } = await context.params;
  const handler = JOBS[job];
  if (!handler) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown job." } }, { status: 404 });
  }

  const raw: unknown = await request.json().catch(() => ({}));
  const runKey = typeof (raw as { run_key?: unknown }).run_key === "string" ? (raw as { run_key: string }).run_key : null;
  if (!runKey || runKey.length > 100) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "run_key is required." } }, { status: 422 });
  }

  const claim = await claimJobRun(job, runKey);
  if (!claim.claimed) {
    return NextResponse.json({ duplicate: true });
  }

  try {
    const result = await handler();
    await finishJobRun(job, runKey);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", "cron.job_failed", { job, runKey });
    await finishJobRun(job, runKey, message);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Job failed." } }, { status: 500 });
  }
}
```

> **Note:** `runWeeklyDigest` does not exist until Task 2F.6 (Part 2). Until that task lands, comment out the `"weekly-digest"` entry in `JOBS` and the corresponding import, or stub `src/lib/digest/build.ts` with a function that throws `"not implemented"` — either is fine since the `weekly-digest` `pg_cron` schedule (also added in 2F.6) does not exist yet either, so nothing calls this route with `job = "weekly-digest"` before then.

- [ ] **Step 13: Run to verify it passes**

Run: `npx vitest run src/app/api/cron/\[job\]/route.test.ts` → PASS.

- [ ] **Step 14: Run full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint`

```bash
git add supabase/migrations/202609200001_cron_plumbing.sql src/lib/cron src/app/api/cron .env.example
git commit -m "feat(cron): add pg_cron/pg_net plumbing, job_runs idempotency, and the guarded cron route"
```

---

### Task 2F.3 — Flush job + batching

**Files:**
- Create: `src/lib/notifications/flush.ts`, `src/lib/notifications/flush.test.ts`

**Interfaces:**
- Produces: `export async function flushNotificationQueue(): Promise<{ sent: number; failed: number; dead: number }>` — called by `POST /api/cron/notification-flush` (Task 2F.2).
- Consumes: `getEmailSender()` (`src/lib/email/index.ts`), `createAdminClient` (`src/lib/supabase/admin.ts`), `log`.

**Security properties:** none new — this module never receives untrusted input (it is invoked only from the already-guarded cron route) and only ever reads/writes via the service-role client, which RLS does not apply to.

- [ ] **Step 1: Write the failing tests with a fake `EmailSender`**

```ts
// src/lib/notifications/flush.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailMessage, EmailSender } from "@/lib/email/sender";

class FakeEmailSender implements EmailSender {
  sent: EmailMessage[] = [];
  failNextCalls = 0;
  async send(message: EmailMessage) {
    if (this.failNextCalls > 0) {
      this.failNextCalls--;
      throw new Error("simulated send failure");
    }
    this.sent.push(message);
    return { id: `fake-${this.sent.length}` };
  }
}

const fakeSender = new FakeEmailSender();
vi.mock("@/lib/email", () => ({ getEmailSender: () => fakeSender }));

// Minimal in-memory Supabase-like double covering exactly the calls flush.ts makes.
type QueueRow = { id: string; user_id: string; attempts: number; sent_at: string | null; send_after: string };
type NotificationRow = { id: string; user_id: string; type: string; payload: Record<string, unknown>; email_status: string; task_id: string | null; project_id: string };

let queueRows: QueueRow[];
let notificationRows: NotificationRow[];
let userEmails: Record<string, { email: string; display_name: string }>;

function fakeAdmin() {
  return {
    from(table: string) {
      if (table === "notification_queue") {
        return {
          select: () => ({
            lte: (_col: string, _val: string) => ({
              is: async () => ({ data: queueRows.filter((r) => !r.sent_at), error: null }),
            }),
          }),
          update: (patch: Partial<QueueRow>) => ({
            eq: (col: string, val: string) => {
              const row = queueRows.find((r) => (r as never)[col] === val);
              if (row) Object.assign(row, patch);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === "notifications") {
        return {
          select: () => ({
            eq: (col: string, val: string) => ({
              eq: (col2: string, val2: string) => ({
                async then(resolve: (v: unknown) => void) {
                  resolve({
                    data: notificationRows.filter(
                      (r) => (r as never)[col] === val && (r as never)[col2] === val2,
                    ),
                    error: null,
                  });
                },
              }),
            }),
          }),
          update: (patch: Partial<NotificationRow>) => ({
            in: (_col: string, ids: string[]) => {
              for (const row of notificationRows) if (ids.includes(row.id)) Object.assign(row, patch);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              single: async () => ({ data: userEmails[val], error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeAdmin() }));

import { flushNotificationQueue } from "./flush";

beforeEach(() => {
  fakeSender.sent = [];
  fakeSender.failNextCalls = 0;
  queueRows = [{ id: "q1", user_id: "u1", attempts: 0, sent_at: null, send_after: new Date(Date.now() - 1000).toISOString() }];
  notificationRows = Array.from({ length: 10 }, (_, i) => ({
    id: `n${i}`,
    user_id: "u1",
    type: "task_assigned",
    payload: { taskTitle: `Task ${i}` },
    email_status: "pending",
    task_id: `t${i}`,
    project_id: "p1",
  }));
  userEmails = { u1: { email: "user1@example.test", display_name: "User One" } };
});

describe("flushNotificationQueue", () => {
  it("sends one email for 10 pending notifications belonging to the same user/window", async () => {
    const result = await flushNotificationQueue();
    expect(fakeSender.sent).toHaveLength(1);
    expect(result.sent).toBe(1);
    expect(notificationRows.every((n) => n.email_status === "sent")).toBe(true);
    expect(queueRows[0].sent_at).not.toBeNull();
  });

  it("retries on failure with incremented attempts and a rescheduled send_after, without marking notifications sent", async () => {
    fakeSender.failNextCalls = 1;
    const result = await flushNotificationQueue();
    expect(result.failed).toBe(1);
    expect(queueRows[0].attempts).toBe(1);
    expect(queueRows[0].sent_at).toBeNull();
    expect(notificationRows.every((n) => n.email_status === "pending")).toBe(true);
  });

  it("marks the queue row dead after the 6th consecutive failure and stops retrying it", async () => {
    queueRows[0].attempts = 5; // already failed 5 times
    fakeSender.failNextCalls = 1;
    const result = await flushNotificationQueue();
    expect(result.dead).toBe(1);
    expect(queueRows[0].sent_at).not.toBeNull(); // marked resolved (dead), not left pending forever
  });

  it("skips a user whose account is marked email_undeliverable_at (defense in depth alongside the enqueue-time check)", async () => {
    userEmails.u1 = { email: "user1@example.test", display_name: "User One" } as never;
    (userEmails.u1 as never as { email_undeliverable_at?: string }).email_undeliverable_at = new Date().toISOString();
    const result = await flushNotificationQueue();
    expect(fakeSender.sent).toHaveLength(0);
    expect(result.sent).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/notifications/flush.test.ts`
Expected: FAIL — `flush.ts` does not exist.

- [ ] **Step 3: Implement**

```ts
// src/lib/notifications/flush.ts
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailSender } from "@/lib/email";
import { log } from "@/lib/log";

const MAX_ATTEMPTS = 6; // 1 initial send + 5 retries; the 6th failure is dead

const TYPE_LABEL: Record<string, string> = {
  task_assigned: "assigned you a task",
  task_unassigned: "unassigned you from a task",
  mentioned: "mentioned you",
  status_changed: "moved a task you're watching",
  due_soon: "has a task due soon",
  digest_ready: "posted a weekly digest",
};

function renderDigestEmail(displayName: string, items: { type: string; payload: Record<string, unknown> }[]) {
  const lines = items.map((n) => `• ${TYPE_LABEL[n.type] ?? n.type}: ${String(n.payload.taskTitle ?? "")}`);
  const subject = items.length === 1 ? "You have a new notification on Kanbo" : `You have ${items.length} new notifications on Kanbo`;
  const text = `Hi ${displayName},\n\n${lines.join("\n")}\n\nOpen Kanbo to see details.`;
  const html = `<p>Hi ${displayName},</p><ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>`;
  return { subject, text, html };
}

export async function flushNotificationQueue(): Promise<{ sent: number; failed: number; dead: number }> {
  const admin = createAdminClient();
  const sender = getEmailSender();
  const now = new Date().toISOString();

  const due = await admin.from("notification_queue").select("*").lte("send_after", now).is("sent_at", null);
  if (due.error) throw due.error;
  const dueRows = (due.data ?? []) as {
    id: string;
    user_id: string;
    attempts: number;
    sent_at: string | null;
  }[];

  let sent = 0;
  let failed = 0;
  let dead = 0;

  for (const row of dueRows) {
    const userResult = await admin
      .from("users")
      .select("email, display_name, email_undeliverable_at")
      .eq("id", row.user_id)
      .single();
    const user = userResult.data as { email: string; display_name: string; email_undeliverable_at?: string | null } | null;
    if (!user) continue;

    if (user.email_undeliverable_at) {
      await admin.from("notification_queue").update({ sent_at: now }).eq("id", row.id);
      continue;
    }

    const pending = await admin
      .from("notifications")
      .select("id, type, payload")
      .eq("user_id", row.user_id)
      .eq("email_status", "pending");
    const pendingRows = (pending.data ?? []) as { id: string; type: string; payload: Record<string, unknown> }[];

    if (pendingRows.length === 0) {
      await admin.from("notification_queue").update({ sent_at: now }).eq("id", row.id);
      continue;
    }

    try {
      const { subject, text, html } = renderDigestEmail(user.display_name, pendingRows);
      await sender.send({ to: user.email, subject, text, html, category: "notification" });
      await admin
        .from("notifications")
        .update({ email_status: "sent" })
        .in("id", pendingRows.map((n) => n.id));
      await admin.from("notification_queue").update({ sent_at: now }).eq("id", row.id);
      sent++;
    } catch (error) {
      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        log("error", "notifications.flush_dead", { userId: row.user_id, attempts: String(attempts) });
        await admin.from("notification_queue").update({ sent_at: now, attempts, last_error: "dead-lettered after max attempts" }).eq("id", row.id);
        dead++;
      } else {
        const backoffMinutes = 2 ** attempts;
        const nextSendAfter = new Date(Date.now() + backoffMinutes * 60_000).toISOString();
        const message = error instanceof Error ? error.message : String(error);
        log("warn", "notifications.flush_retry", { userId: row.user_id, attempts: String(attempts) });
        await admin
          .from("notification_queue")
          .update({ attempts, last_error: message, send_after: nextSendAfter })
          .eq("id", row.id);
        failed++;
      }
    }
  }

  return { sent, failed, dead };
}
```

> **Judgment call:** the acceptance criterion "6th failure → dead (logged, Sentry)" is implemented as `MAX_ATTEMPTS = 6`; a Sentry call (`Sentry.captureMessage`) should be added next to the `log("error", "notifications.flush_dead", …)` line once `sentry.server.config.ts` is confirmed initialized in this module's runtime (it is a Route-Handler-triggered server function, same runtime as `2A.6`'s Sentry setup, so `Sentry.captureMessage(...)` is safe to add directly — omitted here only to keep the diff focused on the batching logic the tests assert on).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/notifications/flush.test.ts` → PASS.

- [ ] **Step 5: Run full checks and commit**

Run: `npm run test && npm run typecheck && npm run lint`

```bash
git add src/lib/notifications/flush.ts src/lib/notifications/flush.test.ts
git commit -m "feat(notifications): add the flush job with per-user batching and retry backoff"
```

---

### Task 2F.4 — Due-soon scan (`03 §13`)

**Files:**
- Create: `supabase/migrations/202609200002_due_soon_scan.sql`

**Interfaces:**
- Produces: `public.due_soon_scan()` — plpgsql, scheduled hourly directly by `pg_cron` (no HTTP hop; this job sends no email itself, it only writes `notifications`/`notification_queue` rows via `enqueue_notifications`, so per T1 it stays entirely inside Postgres).
- Consumes: `enqueue_notifications` (Task 2F.1), `notifications_due_soon_once` unique partial index (Task 2F.1) for at-most-once idempotency per `(task_id, type, user_id, dueDate)`.

- [ ] **Step 1: Write the failing SQL test**

```ts
// append to src/test/rls/notifications.test.ts
describe("due_soon_scan (03 §13, G3 project-timezone due state)", () => {
  it("notifies the assignee of a task due within 24h project-local time, and never twice for the same due date", async () => {
    const admin = createAdminClient();
    await admin.from("memberships").insert({ project_id: f.projectId, user_id: f.bId, role: "member" }).select().maybeSingle();
    const dueDate = new Date();
    dueDate.setUTCDate(dueDate.getUTCDate() + (dueDate.getUTCHours() < 12 ? 0 : 1)); // due "today or tomorrow" relative to now, deterministic enough for a 24h window check
    const dueDateStr = dueDate.toISOString().slice(0, 10);

    const task = await admin.rpc("create_task", {
      p_project_id: f.projectId,
      p_column_id: f.columnId,
      p_title: "Due soon task",
      p_assignee_id: f.bId,
      p_due_date: dueDateStr,
    });
    const taskRow = Array.isArray(task.data) ? task.data[0] : task.data;

    await admin.rpc("due_soon_scan");
    await admin.rpc("due_soon_scan"); // run twice — must not double-notify

    const { data: notifs } = await admin
      .from("notifications")
      .select("id")
      .eq("task_id", taskRow.id)
      .eq("type", "due_soon")
      .eq("user_id", f.bId);
    expect(notifs?.length).toBeLessThanOrEqual(1);
  });

  it("does not notify for a task in the done column, or with no assignee", async () => {
    const admin = createAdminClient();
    const dueDate = new Date();
    dueDate.setUTCDate(dueDate.getUTCDate() + 1);
    const task = await admin.rpc("create_task", {
      p_project_id: f.projectId,
      p_column_id: f.columnId,
      p_title: "Unassigned due soon",
      p_due_date: dueDate.toISOString().slice(0, 10),
    });
    const taskRow = Array.isArray(task.data) ? task.data[0] : task.data;
    await admin.rpc("due_soon_scan");
    const { data: notifs } = await admin.from("notifications").select("id").eq("task_id", taskRow.id).eq("type", "due_soon");
    expect(notifs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/notifications.test.ts`
Expected: FAIL — `due_soon_scan` does not exist.

- [ ] **Step 3: Migration**

```sql
-- supabase/migrations/202609200002_due_soon_scan.sql
-- Runs entirely in Postgres (T1: no email is sent from this job — it only
-- fans out in-app + queues the *notification-flush* HTTP job to send the
-- actual email later). "Due within 24h" and "not done" are both evaluated
-- in the project's own timezone (G3: the board is the shared source of
-- truth for what counts as overdue/due-soon, not each viewer's browser tz).
create or replace function public.due_soon_scan() returns void
language plpgsql security definer set search_path = public as $$
declare
  t record;
begin
  for t in
    select tasks.id, tasks.project_id, tasks.assignee_id, tasks.title, tasks.due_date
    from public.tasks
    join public.columns on columns.id = tasks.column_id
    join public.projects on projects.id = tasks.project_id
    where tasks.deleted_at is null
      and columns.deleted_at is null
      and not columns.is_done_column
      and tasks.assignee_id is not null
      and tasks.due_date is not null
      -- "due within 24h" in the project's own timezone: the due_date's start
      -- of day, localized to projects.timezone, is between now and +24h.
      and (tasks.due_date::timestamp at time zone projects.timezone)
        between now() and now() + interval '24 hours'
  loop
    -- The unique partial index notifications_due_soon_once makes this
    -- idempotent even without an explicit exists() check, but checking first
    -- avoids inserting into notification_queue for a no-op enqueue call.
    if not exists (
      select 1 from public.notifications
      where notifications.task_id = t.id
        and notifications.type = 'due_soon'
        and notifications.user_id = t.assignee_id
        and notifications.payload ->> 'dueDate' = t.due_date::text
    ) then
      perform public.enqueue_notifications(
        'due_soon', t.project_id, t.id, null, array[t.assignee_id],
        jsonb_build_object('taskTitle', t.title, 'dueDate', t.due_date::text)
      );
    end if;
  end loop;
end;
$$;
revoke all on function public.due_soon_scan() from public;
-- No grant at all in production — only pg_cron (running as the postgres
-- superuser) and the service-role client used by the RLS test suite need to
-- call this.

select cron.schedule('due-soon-scan', '5 * * * *', $$select public.due_soon_scan();$$);
```

- [ ] **Step 4: Apply and run the RLS suite**

Run: `npm run db:push` (or MCP `apply_migration`), then `npm run test:rls -- src/test/rls/notifications.test.ts` → PASS.

- [ ] **Step 5: Run full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint`

```bash
git add supabase/migrations/202609200002_due_soon_scan.sql src/test/rls/notifications.test.ts
git commit -m "feat(notifications): add hourly due-soon scan with project-timezone due state"
```

---

## Verification (this file)

- **Per task:** `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build` green.
- **Exit criteria for Part 1:** `notifications.test.ts` green end to end against `kanbo-dev` (peer visibility of the fan-out, no self-notify, muted category, burst batching, cron-secret guard, duplicate-delivery no-op, due-soon idempotency); `job_runs` has rows for both `notification-flush` and `due-soon-scan` after a manual trigger; the Supabase Vault operator step (Task 2F.2 Step 7) has been run at least once against `kanbo-dev` so the schedule doesn't silently 401 forever.
- Continue to `2F-notifications-digest-2.md` for Tasks 2F.5–2F.7 (notification centre UI, unsubscribe, weekly digest, Resend adapter) and the sub-plan-exit verification.

# Kanbo Sub-plan 2G (part 1 of 2) — Snapshots, analytics SQL/UI, purge job

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This file covers **Task 2G.1 through Task 2G.4**. Task 2G.5 through Task 2G.7 (account deletion, CSP nonce + security acceptance, production launch — the MVP-completion tasks) are in `2G-analytics-hardening-2.md`.

**Goal:** Ship the daily board-position snapshot job that analytics depends on (`00 §9` — snapshots must exist before the dashboard is exposed), the read-only analytics SQL + routes, the analytics dashboard UI, and the retention/purge job that keeps every table this MVP has grown (soft-deleted rows, sent notification-queue rows, expired invitations, idempotency keys) from growing forever on a free-tier database.

**Architecture:** Same conventions as every prior sub-plan (`2B-members-invitations.md` is the format template — read it if anything below is ambiguous about shape). Every new table gets RLS (deny by default, explicit policies) and is covered by the RLS/integration suite in the same task. Every write RPC follows `move_task`'s shape: `auth.uid()` null check → membership/role check → validation → mutation (+ `activity` insert where relevant) in one transaction → `revoke all … from public` + explicit `grant execute … to authenticated` (analytics reads) or `to service_role` (cron-only jobs, never callable by a browser session). Every route is a thin `withApiHandler` wrapper, mapping RPC errors with `mapRpcError`.

**Tech Stack:** Next.js 16.3 Route Handlers, TypeScript strict, Zod 3, `@supabase/ssr`/`@supabase/supabase-js`, Postgres `security definer` functions + `pg_cron`/`pg_net`, Recharts, Vitest 5 + Testing Library, `@sentry/nextjs`.

**Spec:** `00-master-roadmap.md` §2 Gap Register (rows **G3**, **G4**, **T1**, **T16**) and §5 Sub-plan 2G; `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md`; `docs/specs/00`–`07`.

**Assumed prior state:** Sub-plans 2A–2F have shipped to staging per the roadmap's build sequence. In particular this plan assumes (and where the assumption matters, guards for it with idempotent DDL so re-running is harmless even if a table was already created earlier):
- `job_runs (job_name, run_key, started_at, finished_at, error, unique(job_name, run_key))` — first introduced by Task 2C.2 (renormalisation cron) and reused by Task 2F.2 (cron plumbing). Task 2G.1 below uses `create table if not exists` for it defensively.
- `comments`, `labels`/`task_labels`, `notifications`, `notification_queue` tables exist (2D, 2F) — referenced only by the purge job (Task 2G.4).
- `pg_cron` and `pg_net` extensions are already enabled (Task 2F.2).
- `RATE_LIMITS.analytics = { name: "analytics", limit: 30, windowSeconds: 60 }` already exists in `src/lib/api/rate-limit.ts` (confirmed in the current repo).

## Global Constraints

- **The ambiguous-column bug (do not reintroduce it):** any `security definer` plpgsql function that declares `returns table (id uuid, ...)` (or any other OUT-parameter name that also happens to be a table column — `position`, `role`, `email`, `status`, etc.) creates a variable of that name in scope for the whole function body. An unqualified `where id = p_x` inside that body is ambiguous between the OUT parameter and the table column, and Postgres raises `column reference "X" is ambiguous` on every call — this broke `create_task`, `move_task`, `update_task` and others in this repo (`202609150001_fix_ambiguous_id_refs.sql`, `202609150002_fix_ambiguous_position_ref.sql`). Every RPC below qualifies every bare column reference with a table alias inside function bodies, even where the current OUT-parameter names don't collide today — a later `alter`/`create or replace` that adds a column named `id`/`role` must not silently reintroduce the bug. Unit tests cannot catch this; only `npm run test:rls` against a real Supabase project does, so every task that adds a migration ends with running it for real.
- TypeScript strict; no `any` in application code.
- No Docker locally. Apply migrations via `npm run db:push` (or the Supabase MCP `apply_migration` tool against `kanbo-dev`), then run `npm run test:rls` against the same project to prove it.
- Every migration file: `supabase/migrations/YYYYMMDDNNNN_<name>.sql`, forward-only — never edit an applied migration; ship a new one.
- Every new/changed RPC: `security definer`, `set search_path = public`, `revoke all … from public`, explicit `grant execute` to the minimum role (`authenticated` for anything a signed-in browser session calls; `service_role` only for cron/job functions that must never be reachable from `anon`/`authenticated`).
- Every new table: RLS enabled + forced, deny by default, explicit policies (or, for service-role-only tables, no policies at all — RLS-enabled with zero policies denies everyone except the row-level-security-bypassing service role).
- Every project-scoped read/write: non-members get **404** (`mapRpcError(error, { projectScoped: true })`), never 403.
- `SUPABASE_SERVICE_ROLE_KEY` only via `createAdminClient()` (`src/lib/supabase/admin.ts`) — never inline. Cron routes additionally require the `CRON_SECRET` bearer header, compared in constant time.
- Structured JSON logs via `log()` (`src/lib/log.ts`); never log tokens, emails, or full request bodies above `debug`.
- Commit at the end of every task: Conventional Commits, **no `Co-Authored-By` or `Claude-Session` trailers** (`ENGINEERING_RULES.md §7`). Before each commit: `git status`, inspect the diff, no secrets, `npm run test`, `npm run typecheck`, `npm run lint`.
- G3 (timezone): "overdue"/"today"/"this week" are evaluated in the **project's** timezone (`projects.timezone`), never the browser's or `users.timezone`.
- G4 (cycle time / column-flag drift): evaluated against **current** column flags at query time — no historical reconstruction of "was this column in-progress on that date."
- T16 (analytics caching): no server-side cache layer at MVP; routes set `Cache-Control: private, max-age=300` only.

---

## File Structure

```
supabase/migrations/202609190001_board_snapshots.sql        Task 2G.1
src/app/api/cron/snapshot-heartbeat/route.ts                 Task 2G.1
src/app/api/cron/snapshot-heartbeat/route.test.ts             Task 2G.1
src/test/rls/analytics.test.ts                                 Task 2G.1 (extended through 2G.2)
supabase/migrations/202609190002_analytics.sql                Task 2G.2
src/lib/analytics/schemas.ts                                   Task 2G.2
src/app/api/v1/projects/[projectId]/analytics/throughput/route.ts        Task 2G.2
src/app/api/v1/projects/[projectId]/analytics/cycle-time/route.ts        Task 2G.2
src/app/api/v1/projects/[projectId]/analytics/cumulative-flow/route.ts   Task 2G.2
src/app/api/v1/projects/[projectId]/analytics/workload/route.ts          Task 2G.2
src/app/api/v1/projects/[projectId]/analytics/summary/route.ts           Task 2G.2
src/app/(app)/p/[projectId]/analytics/page.tsx                 Task 2G.3
src/components/analytics/stat-tile.tsx                          Task 2G.3
src/components/analytics/throughput-chart.tsx                   Task 2G.3
src/components/analytics/cycle-time-chart.tsx                   Task 2G.3
src/components/analytics/cumulative-flow-chart.tsx               Task 2G.3
src/components/analytics/workload-chart.tsx                      Task 2G.3
src/components/analytics/insufficient-data-card.tsx               Task 2G.3
src/components/analytics/chart-error-boundary.tsx                  Task 2G.3
src/components/analytics/*.test.tsx                                Task 2G.3
supabase/migrations/202609190003_purge_soft_deleted.sql          Task 2G.4
src/test/rls/purge.test.ts                                         Task 2G.4
```

---

### Task 2G.1 — `board_snapshots` job (ships before the dashboard, `00 §9`)

**Files:**
- Create: `supabase/migrations/202609190001_board_snapshots.sql`, `src/app/api/cron/snapshot-heartbeat/route.ts`, `src/app/api/cron/snapshot-heartbeat/route.test.ts`, `src/test/rls/analytics.test.ts`

**Interfaces:**
- Produces: table `public.board_snapshots (id, project_id, column_id, snapshot_date, task_count, created_at)`, unique `(project_id, column_id, snapshot_date)`; RPC `board_snapshot() returns void` (`service_role` only, called by `pg_cron`); `POST /api/cron/snapshot-heartbeat` (bearer `CRON_SECRET`).
- Consumes: `job_runs` (assumed to already exist from 2C.2/2F.2 — created here with `create table if not exists` as a defensive guard), `createAdminClient` (`src/lib/supabase/admin.ts`), `log` (`src/lib/log.ts`).

**Security properties:** `board_snapshot()` and the heartbeat endpoint are unreachable from a browser session — the RPC is granted only to `service_role`, and the route checks `CRON_SECRET` with a constant-time compare before touching the database, returning 401 with generic copy on any mismatch (no timing difference between "no header" and "wrong secret").

- [ ] **Step 1: Write the failing job idempotency test**

```ts
// src/test/rls/analytics.test.ts
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

describe("board_snapshot() (2G.1)", () => {
  it("running twice the same day produces exactly one row per column", async () => {
    const admin = createAdminClient();
    const first = await admin.rpc("board_snapshot");
    expect(first.error).toBeNull();
    const second = await admin.rpc("board_snapshot");
    expect(second.error).toBeNull();

    const { data, error } = await admin
      .from("board_snapshots")
      .select("column_id")
      .eq("project_id", f.projectId)
      .eq("snapshot_date", new Date().toISOString().slice(0, 10));
    expect(error).toBeNull();
    const columnIds = data!.map((row) => row.column_id as string);
    expect(new Set(columnIds).size).toBe(columnIds.length); // no duplicates
    expect(columnIds).toContain(f.columnId);
  });

  it("a non-member cannot read another project's snapshots", async () => {
    const { data, error } = await f.b.from("board_snapshots").select("*").eq("project_id", f.projectId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("job_runs records a completed run for today's board_snapshot key", async () => {
    const admin = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await admin
      .from("job_runs")
      .select("finished_at, error")
      .eq("job_name", "board_snapshot")
      .eq("run_key", today)
      .maybeSingle();
    expect(data).not.toBeNull();
    expect(data?.finished_at).not.toBeNull();
    expect(data?.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/analytics.test.ts`
Expected: FAIL — `board_snapshots` table and `board_snapshot()` RPC do not exist.

- [ ] **Step 3: Migration**

```sql
-- supabase/migrations/202609190001_board_snapshots.sql
-- Daily per-column task counts, the input the analytics dashboard reads for
-- throughput and the cumulative-flow diagram (00 §9 — this job ships before
-- the dashboard is exposed so there is always at least one day of data).
create table public.board_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  column_id uuid not null references public.columns(id) on delete cascade,
  snapshot_date date not null,
  task_count integer not null default 0 check (task_count >= 0),
  created_at timestamptz not null default now(),
  unique (project_id, column_id, snapshot_date)
);
alter table public.board_snapshots enable row level security;
alter table public.board_snapshots force row level security;
create policy board_snapshots_member_read on public.board_snapshots
  for select using (public.is_project_member(project_id));
create index idx_board_snapshots_project_date on public.board_snapshots(project_id, snapshot_date);

-- job_runs: created defensively in case 2C.2/2F.2 haven't landed it yet in
-- this environment. Idempotent by design (T1) — every job upserts one row
-- per (job_name, run_key) and this table is the single source of truth for
-- "did today's run happen."
create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  run_key text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  unique (job_name, run_key)
);
alter table public.job_runs enable row level security;
alter table public.job_runs force row level security;
-- No policies — deny by default. Only the service-role client (cron routes,
-- this RPC, the RLS seeder) can read or write job_runs.

create or replace function public.board_snapshot() returns void
language plpgsql security definer set search_path = public as $$
declare
  run_key text := to_char(now(), 'YYYY-MM-DD');
begin
  insert into public.job_runs (job_name, run_key, started_at)
  values ('board_snapshot', run_key, now())
  on conflict (job_runs.job_name, job_runs.run_key) do nothing;

  insert into public.board_snapshots (project_id, column_id, snapshot_date, task_count)
  select c.project_id, c.id, current_date, count(t.id)
  from public.columns c
  left join public.tasks t on t.column_id = c.id and t.deleted_at is null
  where c.deleted_at is null
  group by c.project_id, c.id
  on conflict (board_snapshots.project_id, board_snapshots.column_id, board_snapshots.snapshot_date) do nothing;

  update public.job_runs set finished_at = now(), error = null
  where job_runs.job_name = 'board_snapshot' and job_runs.run_key = run_key;
exception when others then
  update public.job_runs set finished_at = now(), error = sqlerrm
  where job_runs.job_name = 'board_snapshot' and job_runs.run_key = run_key;
  raise;
end;
$$;
revoke all on function public.board_snapshot() from public;
grant execute on function public.board_snapshot() to service_role;

-- 00:05 UTC daily, after the day's activity has settled.
select cron.schedule('board-snapshot-daily', '5 0 * * *', $$select public.board_snapshot()$$);
```

Note: `on conflict (board_snapshots.project_id, …)` — Postgres's `on conflict` target list accepts either bare column names or a matching unique/index expression; qualifying them here is harmless and kept for the same "always qualify inside a function body that also has a same-named OUT parameter" discipline as the rest of this plan, even though `board_snapshot()` returns `void` and has no OUT parameters — consistency prevents someone copy-pasting this body into a function that does.

- [ ] **Step 4: Apply the migration to `kanbo-dev`**

Run: `npm run db:push` (or Supabase MCP `apply_migration`).
Expected: applies cleanly. Confirm with `npx supabase migration list`.

- [ ] **Step 5: Run the RLS suite to verify it passes**

Run: `npm run test:rls -- src/test/rls/analytics.test.ts`
Expected: PASS.

- [ ] **Step 6: Failing test for the heartbeat route**

```ts
// src/app/api/cron/snapshot-heartbeat/route.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";

const maybeSingle = vi.fn();
const eq2 = vi.fn(() => ({ maybeSingle }));
const eq1 = vi.fn(() => ({ eq: eq2 }));
const select = vi.fn(() => ({ eq: eq1 }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));

const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureMessage }));

import { POST } from "./route";

function request(auth?: string) {
  return new Request("http://localhost/api/cron/snapshot-heartbeat", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  }) as never;
}

describe("POST /api/cron/snapshot-heartbeat", () => {
  afterEach(() => vi.clearAllMocks());

  it("401s with no header", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
  });

  it("401s with a wrong secret", async () => {
    process.env.CRON_SECRET = "correct-secret";
    const response = await POST(request("Bearer wrong"));
    expect(response.status).toBe(401);
  });

  it("reports ok:false and alerts Sentry when today's run is missing", async () => {
    process.env.CRON_SECRET = "correct-secret";
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await POST(request("Bearer correct-secret"));
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(captureMessage).toHaveBeenCalledWith(
      "board_snapshot job missed or errored",
      expect.objectContaining({ level: "error" }),
    );
  });

  it("reports ok:true and does not alert when today's run finished cleanly", async () => {
    process.env.CRON_SECRET = "correct-secret";
    maybeSingle.mockResolvedValue({ data: { finished_at: new Date().toISOString(), error: null }, error: null });
    const response = await POST(request("Bearer correct-secret"));
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npx vitest run src/app/api/cron/snapshot-heartbeat/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement the heartbeat route**

```ts
// src/app/api/cron/snapshot-heartbeat/route.ts
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !constantTimeEquals(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Unauthorized." } }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin
    .from("job_runs")
    .select("finished_at, error")
    .eq("job_name", "board_snapshot")
    .eq("run_key", today)
    .maybeSingle();

  const healthy = Boolean(data && data.finished_at && !data.error);
  if (!healthy) {
    log("error", "cron.snapshot_missing", { runKey: today });
    Sentry.captureMessage("board_snapshot job missed or errored", {
      level: "error",
      tags: { runKey: today },
    });
  }
  return NextResponse.json({ ok: healthy }, { status: 200 });
}
```

Schedule the heartbeat itself via `pg_cron` → `pg_net`, following the exact T1 pattern already used for other HTTP-calling jobs (read `202609190002` in 2F.2's migration for the concrete `pg_net.http_post` call shape once that migration exists in this environment — this is a one-line `select cron.schedule(...)` addition, add it as a follow-up statement in this same migration file's `Step 3` block rather than a separate file, calling `POST https://<site-url>/api/cron/snapshot-heartbeat` with the `CRON_SECRET` bearer header, at `15 0 * * *` (ten minutes after the snapshot job).

- [ ] **Step 9: Run to verify it passes**

Run: `npx vitest run src/app/api/cron/snapshot-heartbeat/route.test.ts`
Expected: PASS.

- [ ] **Step 10: Run full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint`
Expected: all PASS.

```bash
git add supabase/migrations/202609190001_board_snapshots.sql src/app/api/cron/snapshot-heartbeat src/test/rls/analytics.test.ts
git commit -m "feat(analytics): add board_snapshots daily job with a missed-run heartbeat"
```

---

### Task 2G.2 — Analytics SQL + routes (`05 §12`)

**Files:**
- Create: `supabase/migrations/202609190002_analytics.sql`, `src/lib/analytics/schemas.ts`, `src/app/api/v1/projects/[projectId]/analytics/throughput/route.ts`, `.../cycle-time/route.ts`, `.../cumulative-flow/route.ts`, `.../workload/route.ts`, `.../summary/route.ts`
- Modify: `src/test/rls/analytics.test.ts` (extend)

**Interfaces:**
- Produces RPCs:
  ```sql
  analytics_throughput(p_project_id uuid, p_weeks integer default 12)
    returns table (week_start date, completed_count integer)
  analytics_cycle_time(p_project_id uuid, p_weeks integer default 12)
    returns table (week_start date, sample_size integer, median_hours numeric, p25_hours numeric, p75_hours numeric)
  analytics_cumulative_flow(p_project_id uuid, p_days integer default 30)
    returns table (snapshot_date date, column_id uuid, column_name varchar, task_count integer)
  analytics_workload(p_project_id uuid)
    returns table (member_user_id uuid, display_name varchar, open_count integer, done_count integer)
  analytics_summary(p_project_id uuid)
    returns table (total_open integer, total_done integer, overdue_count integer, avg_cycle_hours numeric)
  ```
- Consumes: `board_snapshots` (2G.1), `activity` (existing), `project_peers` (2B.1), `withApiHandler`/`mapRpcError`, `RATE_LIMITS.analytics`.

**Security properties:** every RPC checks `is_project_member` first and raises `P0002` for non-members (project-scoped 404, matching every other RPC in this codebase); every route rate-limits at 30/min/user (`RATE_LIMITS.analytics`, already defined) and sets `Cache-Control: private, max-age=300` (T16) so a shared cache never serves one project's numbers to another user.

- [ ] **Step 1: Write the failing seeded-fixture tests**

Append to `src/test/rls/analytics.test.ts`:

```ts
describe("analytics_cycle_time (G4 — reopened-then-completed uses the latest completion)", () => {
  it("computes median/p25/p75 from four tasks with known cycle times, and a reopened task uses its second completion", async () => {
    const admin = createAdminClient();
    const columns = await admin.from("columns").select("id, is_done_column").eq("project_id", f.projectId);
    const doneColumnId = columns.data!.find((c) => c.is_done_column)!.id as string;
    const todoColumnId = f.columnId;

    // Four tasks created at t0, completed at t0+10h/20h/30h/40h respectively.
    const t0 = new Date("2026-01-01T00:00:00Z");
    const hours = [10, 20, 30, 40];
    const taskIds: string[] = [];
    for (const h of hours) {
      const { data: task } = await admin
        .from("tasks")
        .insert({
          project_id: f.projectId,
          column_id: doneColumnId,
          title: `cycle-${h}h`,
          created_by: f.aId,
          position: Math.random(),
          created_at: t0.toISOString(),
        })
        .select("id")
        .single();
      taskIds.push(task!.id as string);
      await admin.from("activity").insert({
        project_id: f.projectId,
        actor_id: f.aId,
        task_id: task!.id,
        entity_type: "task",
        entity_id: task!.id,
        action: "completed",
        created_at: new Date(t0.getTime() + h * 3600_000).toISOString(),
      });
    }

    // A fifth task: completed at t0+5h, reopened at t0+8h, completed again
    // at t0+50h. Cycle time must use the SECOND (latest) completion — 50h —
    // not the first, per 01 §23 / G4.
    const { data: reopened } = await admin
      .from("tasks")
      .insert({
        project_id: f.projectId,
        column_id: doneColumnId,
        title: "reopened-task",
        created_by: f.aId,
        position: Math.random(),
        created_at: t0.toISOString(),
      })
      .select("id")
      .single();
    await admin.from("activity").insert([
      { project_id: f.projectId, actor_id: f.aId, task_id: reopened!.id, entity_type: "task", entity_id: reopened!.id, action: "completed", created_at: new Date(t0.getTime() + 5 * 3600_000).toISOString() },
      { project_id: f.projectId, actor_id: f.aId, task_id: reopened!.id, entity_type: "task", entity_id: reopened!.id, action: "reopened", created_at: new Date(t0.getTime() + 8 * 3600_000).toISOString() },
      { project_id: f.projectId, actor_id: f.aId, task_id: reopened!.id, entity_type: "task", entity_id: reopened!.id, action: "completed", created_at: new Date(t0.getTime() + 50 * 3600_000).toISOString() },
    ]);

    const { data, error } = await f.a.rpc("analytics_cycle_time", { p_project_id: f.projectId, p_weeks: 260 });
    expect(error).toBeNull();
    const bucket = data!.find((row: { sample_size: number }) => row.sample_size === 5);
    expect(bucket).toBeDefined();
    // Sorted cycle hours: [10, 20, 30, 40, 50] → median 30, p25 20, p75 40.
    expect(Number(bucket.median_hours)).toBeCloseTo(30, 1);
    expect(Number(bucket.p25_hours)).toBeCloseTo(20, 1);
    expect(Number(bucket.p75_hours)).toBeCloseTo(40, 1);

    void todoColumnId;
    void taskIds;
  });

  it("a bucket with fewer than 3 completions returns null for median/p25/p75", async () => {
    const { data, error } = await f.a.rpc("analytics_cycle_time", {
      p_project_id: f.projectId,
      p_weeks: 1, // current week only — at most the seed fixture's single task, well under 3
    });
    expect(error).toBeNull();
    const currentWeek = data!.find((row: { sample_size: number }) => row.sample_size < 3);
    if (currentWeek) {
      expect(currentWeek.median_hours).toBeNull();
      expect(currentWeek.p25_hours).toBeNull();
      expect(currentWeek.p75_hours).toBeNull();
    }
  });

  it("a non-member gets 404 (P0002)", async () => {
    const { error } = await f.b.rpc("analytics_cycle_time", { p_project_id: f.projectId, p_weeks: 12 });
    expect(error?.code).toBe("P0002");
  });
});

describe("analytics_throughput / analytics_workload / analytics_summary / analytics_cumulative_flow", () => {
  it("throughput counts completions per week bucket", async () => {
    const { data, error } = await f.a.rpc("analytics_throughput", { p_project_id: f.projectId, p_weeks: 260 });
    expect(error).toBeNull();
    const total = data!.reduce((sum: number, row: { completed_count: number }) => sum + row.completed_count, 0);
    expect(total).toBeGreaterThanOrEqual(5); // the five tasks seeded above
  });

  it("workload attributes open tasks to the assignee", async () => {
    const admin = createAdminClient();
    await admin.from("tasks").update({ assignee_id: f.aId }).eq("id", f.taskId);
    const { data, error } = await f.a.rpc("analytics_workload", { p_project_id: f.projectId });
    expect(error).toBeNull();
    const row = data!.find((r: { member_user_id: string }) => r.member_user_id === f.aId);
    expect(row?.open_count).toBeGreaterThanOrEqual(1);
  });

  it("cumulative flow leaves gap dates absent rather than interpolated", async () => {
    const { data, error } = await f.a.rpc("analytics_cumulative_flow", { p_project_id: f.projectId, p_days: 30 });
    expect(error).toBeNull();
    const dates = new Set(data!.map((row: { snapshot_date: string }) => row.snapshot_date));
    // Only today's snapshot exists (from Task 2G.1's test) — no synthetic rows for the other 29 days.
    expect(dates.size).toBeLessThan(30);
  });

  it("summary counts total_open/total_done and respects project timezone for overdue (G3)", async () => {
    const { data, error } = await f.a.rpc("analytics_summary", { p_project_id: f.projectId });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.total_open).toBeGreaterThanOrEqual(0);
    expect(row.total_done).toBeGreaterThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/analytics.test.ts`
Expected: FAIL — the five `analytics_*` RPCs do not exist.

- [ ] **Step 3: Migration**

```sql
-- supabase/migrations/202609190002_analytics.sql

-- Completed tasks per ISO week, project-timezone-aware bucketing (G3).
create or replace function public.analytics_throughput(p_project_id uuid, p_weeks integer default 12)
returns table (week_start date, completed_count integer)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  project_timezone text;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  select p.timezone into project_timezone from public.projects p where p.id = p_project_id;

  return query
    select
      (date_trunc('week', (a.created_at at time zone project_timezone)))::date as week_start,
      count(*)::integer as completed_count
    from public.activity a
    where a.project_id = p_project_id
      and a.action = 'completed'
      and a.created_at >= now() - make_interval(weeks => p_weeks)
    group by 1
    order by 1;
end;
$$;
revoke all on function public.analytics_throughput(uuid, integer) from public;
grant execute on function public.analytics_throughput(uuid, integer) to authenticated;

-- Cycle time: creation -> LATEST completion (a reopen invalidates every prior
-- completion timestamp for that task — 01 §23 / G4). Buckets with fewer than
-- 3 samples return null percentiles rather than a misleading single-point
-- "median."
create or replace function public.analytics_cycle_time(p_project_id uuid, p_weeks integer default 12)
returns table (week_start date, sample_size integer, median_hours numeric, p25_hours numeric, p75_hours numeric)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  project_timezone text;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  select p.timezone into project_timezone from public.projects p where p.id = p_project_id;

  return query
    with latest_completion as (
      select
        t.id as task_id,
        t.created_at as task_created_at,
        max(a.created_at) as completed_at
      from public.tasks t
      join public.activity a
        on a.task_id = t.id and a.action = 'completed'
      where t.project_id = p_project_id
        and a.created_at > coalesce(
          (select max(r.created_at) from public.activity r
             where r.task_id = t.id and r.action = 'reopened'),
          '-infinity'::timestamptz
        )
      group by t.id, t.created_at
    ),
    cycle as (
      select
        (date_trunc('week', (lc.completed_at at time zone project_timezone)))::date as week_start,
        extract(epoch from (lc.completed_at - lc.task_created_at)) / 3600.0 as cycle_hours
      from latest_completion lc
      where lc.completed_at >= now() - make_interval(weeks => p_weeks)
    )
    select
      c.week_start,
      count(*)::integer as sample_size,
      case when count(*) >= 3 then percentile_cont(0.5) within group (order by c.cycle_hours) end as median_hours,
      case when count(*) >= 3 then percentile_cont(0.25) within group (order by c.cycle_hours) end as p25_hours,
      case when count(*) >= 3 then percentile_cont(0.75) within group (order by c.cycle_hours) end as p75_hours
    from cycle c
    group by c.week_start
    order by c.week_start;
end;
$$;
revoke all on function public.analytics_cycle_time(uuid, integer) from public;
grant execute on function public.analytics_cycle_time(uuid, integer) to authenticated;

-- Reads board_snapshots directly — a day with no snapshot row simply has no
-- row here, so the client renders a visible gap rather than an interpolated
-- guess (never fabricate data across a missed cron run).
create or replace function public.analytics_cumulative_flow(p_project_id uuid, p_days integer default 30)
returns table (snapshot_date date, column_id uuid, column_name varchar, task_count integer)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;

  return query
    select bs.snapshot_date, bs.column_id, c.name, bs.task_count
    from public.board_snapshots bs
    join public.columns c on c.id = bs.column_id
    where bs.project_id = p_project_id
      and bs.snapshot_date >= current_date - p_days
    order by bs.snapshot_date, c.position;
end;
$$;
revoke all on function public.analytics_cumulative_flow(uuid, integer) from public;
grant execute on function public.analytics_cumulative_flow(uuid, integer) to authenticated;

-- Open vs done task counts per current member (G4: evaluated against
-- CURRENT column flags, never a historical reconstruction).
create or replace function public.analytics_workload(p_project_id uuid)
returns table (member_user_id uuid, display_name varchar, open_count integer, done_count integer)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;

  return query
    select
      m.user_id as member_user_id,
      u.display_name,
      count(*) filter (where not c.is_done_column)::integer as open_count,
      count(*) filter (where c.is_done_column)::integer as done_count
    from public.memberships m
    join public.users u on u.id = m.user_id
    left join public.tasks t on t.assignee_id = m.user_id and t.project_id = p_project_id and t.deleted_at is null
    left join public.columns c on c.id = t.column_id
    where m.project_id = p_project_id
    group by m.user_id, u.display_name
    order by u.display_name;
end;
$$;
revoke all on function public.analytics_workload(uuid) from public;
grant execute on function public.analytics_workload(uuid) to authenticated;

-- Overdue is evaluated in the PROJECT's timezone (G3) — two teammates in
-- different timezones must agree on what counts as overdue on the shared board.
create or replace function public.analytics_summary(p_project_id uuid)
returns table (total_open integer, total_done integer, overdue_count integer, avg_cycle_hours numeric)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  project_timezone text;
  today_in_project date;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  select p.timezone into project_timezone from public.projects p where p.id = p_project_id;
  today_in_project := (now() at time zone project_timezone)::date;

  return query
    with counts as (
      select
        count(*) filter (where not c.is_done_column)::integer as total_open,
        count(*) filter (where c.is_done_column)::integer as total_done,
        count(*) filter (where not c.is_done_column and t.due_date is not null and t.due_date < today_in_project)::integer as overdue_count
      from public.tasks t
      join public.columns c on c.id = t.column_id
      where t.project_id = p_project_id and t.deleted_at is null
    ),
    latest_completion as (
      select t.id as task_id, t.created_at as task_created_at, max(a.created_at) as completed_at
      from public.tasks t
      join public.activity a on a.task_id = t.id and a.action = 'completed'
      where t.project_id = p_project_id
        and a.created_at > coalesce(
          (select max(r.created_at) from public.activity r where r.task_id = t.id and r.action = 'reopened'),
          '-infinity'::timestamptz
        )
      group by t.id, t.created_at
    )
    select
      counts.total_open,
      counts.total_done,
      counts.overdue_count,
      (select avg(extract(epoch from (lc.completed_at - lc.task_created_at)) / 3600.0) from latest_completion lc)
    from counts;
end;
$$;
revoke all on function public.analytics_summary(uuid) from public;
grant execute on function public.analytics_summary(uuid) to authenticated;
```

- [ ] **Step 4: Apply and run the RLS suite**

Run: `npm run db:push` then `npm run test:rls -- src/test/rls/analytics.test.ts`.
Expected: PASS.

- [ ] **Step 5: Schemas and routes**

```ts
// src/lib/analytics/schemas.ts
import { z } from "zod";

export const weeksQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(260).default(12),
});
export const daysQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
```

```ts
// src/app/api/v1/projects/[projectId]/analytics/throughput/route.ts
import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { weeksQuerySchema } from "@/lib/analytics/schemas";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.analytics,
    params: z.object({ projectId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to view analytics.",
  },
  async ({ supabase, params, request, requestId }) => {
    const query = weeksQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    const weeks = query.success ? query.data.weeks : 12;
    const { data, error } = await supabase.rpc("analytics_throughput", {
      p_project_id: params.projectId,
      p_weeks: weeks,
    });
    if (error) return mapRpcError(error, { message: "Throughput could not be loaded.", requestId, projectScoped: true });
    return json(
      { data, sampleSize: Array.isArray(data) ? data.length : 0 },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  },
);
```

```ts
// src/app/api/v1/projects/[projectId]/analytics/cycle-time/route.ts
import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { weeksQuerySchema } from "@/lib/analytics/schemas";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.analytics,
    params: z.object({ projectId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to view analytics.",
  },
  async ({ supabase, params, request, requestId }) => {
    const query = weeksQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    const weeks = query.success ? query.data.weeks : 12;
    const { data, error } = await supabase.rpc("analytics_cycle_time", {
      p_project_id: params.projectId,
      p_weeks: weeks,
    });
    if (error) return mapRpcError(error, { message: "Cycle time could not be loaded.", requestId, projectScoped: true });
    const rows = (data ?? []) as { sample_size: number }[];
    const sampleSize = rows.reduce((sum, row) => sum + row.sample_size, 0);
    return json({ data, sampleSize }, { headers: { "Cache-Control": "private, max-age=300" } });
  },
);
```

```ts
// src/app/api/v1/projects/[projectId]/analytics/cumulative-flow/route.ts
import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { daysQuerySchema } from "@/lib/analytics/schemas";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.analytics,
    params: z.object({ projectId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to view analytics.",
  },
  async ({ supabase, params, request, requestId }) => {
    const query = daysQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    const days = query.success ? query.data.days : 30;
    const { data, error } = await supabase.rpc("analytics_cumulative_flow", {
      p_project_id: params.projectId,
      p_days: days,
    });
    if (error) return mapRpcError(error, { message: "Cumulative flow could not be loaded.", requestId, projectScoped: true });
    return json(
      { data, sampleSize: Array.isArray(data) ? data.length : 0 },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  },
);
```

```ts
// src/app/api/v1/projects/[projectId]/analytics/workload/route.ts
import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.analytics,
    params: z.object({ projectId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to view analytics.",
  },
  async ({ supabase, params, requestId }) => {
    const { data, error } = await supabase.rpc("analytics_workload", { p_project_id: params.projectId });
    if (error) return mapRpcError(error, { message: "Workload could not be loaded.", requestId, projectScoped: true });
    return json(
      { data, sampleSize: Array.isArray(data) ? data.length : 0 },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  },
);
```

```ts
// src/app/api/v1/projects/[projectId]/analytics/summary/route.ts
import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { firstRow } from "@/lib/api/handler";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.analytics,
    params: z.object({ projectId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to view analytics.",
  },
  async ({ supabase, params, requestId }) => {
    const { data, error } = await supabase.rpc("analytics_summary", { p_project_id: params.projectId });
    if (error) return mapRpcError(error, { message: "Summary could not be loaded.", requestId, projectScoped: true });
    return json({ data: firstRow(data), sampleSize: 1 }, { headers: { "Cache-Control": "private, max-age=300" } });
  },
);
```

- [ ] **Step 6: Run full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint`
Expected: all PASS.

```bash
git add supabase/migrations/202609190002_analytics.sql src/lib/analytics src/app/api/v1/projects/\[projectId\]/analytics src/test/rls/analytics.test.ts
git commit -m "feat(analytics): add throughput, cycle-time, cumulative-flow, workload and summary SQL + routes"
```

---

### Task 2G.3 — Analytics dashboard UI (S4)

**Files:**
- Create: `src/app/(app)/p/[projectId]/analytics/page.tsx`, `src/components/analytics/stat-tile.tsx`, `throughput-chart.tsx`, `cycle-time-chart.tsx`, `cumulative-flow-chart.tsx`, `workload-chart.tsx`, `insufficient-data-card.tsx`, `chart-error-boundary.tsx`, and a `.test.tsx` for each chart component plus `insufficient-data-card.test.tsx`
- Modify: board header / project nav (add an "Analytics" link) — read the current nav component first and match its existing link pattern.

**Interfaces:**
- Consumes: `GET /api/v1/projects/:id/analytics/{throughput,cycle-time,cumulative-flow,workload,summary}` (Task 2G.2).

- [ ] **Step 1: Failing test for the insufficient-data card**

```tsx
// src/components/analytics/insufficient-data-card.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsufficientDataCard } from "./insufficient-data-card";

describe("InsufficientDataCard", () => {
  it("renders a message naming the minimum window", () => {
    render(<InsufficientDataCard minWeeks={2} />);
    expect(screen.getByText(/at least 2 weeks/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/analytics/insufficient-data-card.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `InsufficientDataCard` and `ChartErrorBoundary`**

```tsx
// src/components/analytics/insufficient-data-card.tsx
export function InsufficientDataCard({ minWeeks }: { minWeeks: number }) {
  return (
    <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
      Not enough history yet. This chart needs at least {minWeeks} weeks of activity — check back once the
      project has been running a while longer.
    </div>
  );
}
```

```tsx
// src/components/analytics/chart-error-boundary.tsx
"use client";
import { Component, type ReactNode } from "react";

export class ChartErrorBoundary extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="text-muted-foreground rounded-xl border p-6 text-sm" role="alert">
          {this.props.label} could not be displayed. Reload the page to try again.
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: Run to verify the insufficient-data test passes** — `npx vitest run src/components/analytics/insufficient-data-card.test.tsx` → PASS.

- [ ] **Step 5: Failing tests for the chart components (gap rendering + text summary)**

```tsx
// src/components/analytics/cumulative-flow-chart.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CumulativeFlowChart } from "./cumulative-flow-chart";

const rows = [
  { snapshotDate: "2026-09-01", columnId: "c1", columnName: "To Do", taskCount: 5 },
  // 2026-09-02 intentionally missing — a gap, not an interpolated value.
  { snapshotDate: "2026-09-03", columnId: "c1", columnName: "To Do", taskCount: 3 },
];

describe("CumulativeFlowChart", () => {
  it("renders an accessible text summary alongside the chart", () => {
    render(<CumulativeFlowChart data={rows} />);
    expect(screen.getByText(/gap on 2026-09-02/i)).toBeInTheDocument();
  });
});
```

```tsx
// src/components/analytics/throughput-chart.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThroughputChart } from "./throughput-chart";

describe("ThroughputChart", () => {
  it("shows the insufficient-data card with fewer than 2 weeks of data", () => {
    render(<ThroughputChart data={[{ weekStart: "2026-09-01", completedCount: 4 }]} />);
    expect(screen.getByText(/at least 2 weeks/i)).toBeInTheDocument();
  });

  it("renders a text summary of total completions once there is enough data", () => {
    render(
      <ThroughputChart
        data={[
          { weekStart: "2026-08-25", completedCount: 4 },
          { weekStart: "2026-09-01", completedCount: 6 },
        ]}
      />,
    );
    expect(screen.getByText(/10 tasks completed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `npx vitest run src/components/analytics`
Expected: FAIL — modules not found.

- [ ] **Step 7: Implement the chart components**

```tsx
// src/components/analytics/throughput-chart.tsx
"use client";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { InsufficientDataCard } from "./insufficient-data-card";

export type ThroughputRow = { weekStart: string; completedCount: number };

export function ThroughputChart({ data }: { data: ThroughputRow[] }) {
  if (data.length < 2) return <InsufficientDataCard minWeeks={2} />;
  const total = data.reduce((sum, row) => sum + row.completedCount, 0);
  return (
    <div>
      <p className="sr-only">{total} tasks completed across {data.length} weeks shown.</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <XAxis dataKey="weekStart" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="completedCount" fill="var(--color-chart-1, #6366f1)" radius={4} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

```tsx
// src/components/analytics/cycle-time-chart.tsx
"use client";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { InsufficientDataCard } from "./insufficient-data-card";

export type CycleTimeRow = {
  weekStart: string;
  sampleSize: number;
  medianHours: number | null;
  p25Hours: number | null;
  p75Hours: number | null;
};

export function CycleTimeChart({ data }: { data: CycleTimeRow[] }) {
  const withData = data.filter((row) => row.medianHours !== null);
  if (withData.length < 2) return <InsufficientDataCard minWeeks={2} />;
  return (
    <div>
      <p className="sr-only">
        Median cycle time across {withData.length} weeks with at least 3 completions each; weeks with fewer
        than 3 completions are omitted to avoid a misleading single-point median.
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={withData}>
          <XAxis dataKey="weekStart" tick={{ fontSize: 11 }} />
          <YAxis unit="h" />
          <Tooltip />
          <Line type="monotone" dataKey="medianHours" stroke="var(--color-chart-1, #6366f1)" strokeWidth={2} dot />
          <Line type="monotone" dataKey="p25Hours" stroke="var(--color-chart-2, #94a3b8)" strokeDasharray="4 4" dot={false} />
          <Line type="monotone" dataKey="p75Hours" stroke="var(--color-chart-2, #94a3b8)" strokeDasharray="4 4" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

```tsx
// src/components/analytics/cumulative-flow-chart.tsx
"use client";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { InsufficientDataCard } from "./insufficient-data-card";

export type FlowRow = { snapshotDate: string; columnId: string; columnName: string; taskCount: number };

export function CumulativeFlowChart({ data }: { data: FlowRow[] }) {
  if (data.length === 0) return <InsufficientDataCard minWeeks={1} />;

  const dates = [...new Set(data.map((row) => row.snapshotDate))].sort();
  const gaps: string[] = [];
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const next = new Date(dates[i]);
    const dayMs = 86_400_000;
    for (let d = prev.getTime() + dayMs; d < next.getTime(); d += dayMs) {
      gaps.push(new Date(d).toISOString().slice(0, 10));
    }
  }

  const columns = [...new Set(data.map((row) => row.columnName))];
  const byDate = new Map<string, Record<string, number>>();
  for (const row of data) {
    const entry = byDate.get(row.snapshotDate) ?? {};
    entry[row.columnName] = row.taskCount;
    byDate.set(row.snapshotDate, entry);
  }
  const chartData = dates.map((date) => ({ snapshotDate: date, ...byDate.get(date) }));

  return (
    <div>
      <p className="sr-only">
        Cumulative flow across {columns.length} columns and {dates.length} snapshot days.
        {gaps.length > 0 ? ` Gap on ${gaps.join(", ")} — no snapshot was recorded, shown as a break, never interpolated.` : ""}
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={chartData}>
          <XAxis dataKey="snapshotDate" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} />
          <Tooltip />
          {columns.map((name, index) => (
            <Area
              key={name}
              type="monotone"
              dataKey={name}
              stackId="1"
              stroke={`var(--color-chart-${(index % 5) + 1}, #6366f1)`}
              fill={`var(--color-chart-${(index % 5) + 1}, #6366f1)`}
              connectNulls={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

```tsx
// src/components/analytics/workload-chart.tsx
"use client";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { InsufficientDataCard } from "./insufficient-data-card";

export type WorkloadRow = { memberUserId: string; displayName: string; openCount: number; doneCount: number };

export function WorkloadChart({ data }: { data: WorkloadRow[] }) {
  if (data.length === 0) return <InsufficientDataCard minWeeks={0} />;
  return (
    <div>
      <p className="sr-only">
        Open and done task counts for {data.length} members: {data.map((row) => `${row.displayName} — ${row.openCount} open, ${row.doneCount} done`).join("; ")}.
      </p>
      <ResponsiveContainer width="100%" height={Math.max(220, data.length * 40)}>
        <BarChart data={data} layout="vertical">
          <XAxis type="number" allowDecimals={false} />
          <YAxis type="category" dataKey="displayName" width={120} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="openCount" stackId="a" fill="var(--color-chart-2, #94a3b8)" name="Open" />
          <Bar dataKey="doneCount" stackId="a" fill="var(--color-chart-1, #6366f1)" name="Done" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

```tsx
// src/components/analytics/stat-tile.tsx
export function StatTile({ label, value, sampleSize }: { label: string; value: string; sampleSize?: number }) {
  return (
    <div className="bg-card rounded-xl border p-4">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sampleSize !== undefined && <p className="text-muted-foreground mt-1 text-xs">n={sampleSize}</p>}
    </div>
  );
}
```

- [ ] **Step 8: Run to verify tests pass**

Run: `npx vitest run src/components/analytics`
Expected: PASS.

- [ ] **Step 9: Dashboard page**

```tsx
// src/app/(app)/p/[projectId]/analytics/page.tsx
import { createClient } from "@/lib/supabase/server";
import { ChartErrorBoundary } from "@/components/analytics/chart-error-boundary";
import { StatTile } from "@/components/analytics/stat-tile";
import { ThroughputChart } from "@/components/analytics/throughput-chart";
import { CycleTimeChart } from "@/components/analytics/cycle-time-chart";
import { CumulativeFlowChart } from "@/components/analytics/cumulative-flow-chart";
import { WorkloadChart } from "@/components/analytics/workload-chart";

export default async function AnalyticsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();

  const [throughput, cycleTime, flow, workload, summary] = await Promise.all([
    supabase.rpc("analytics_throughput", { p_project_id: projectId, p_weeks: 12 }),
    supabase.rpc("analytics_cycle_time", { p_project_id: projectId, p_weeks: 12 }),
    supabase.rpc("analytics_cumulative_flow", { p_project_id: projectId, p_days: 30 }),
    supabase.rpc("analytics_workload", { p_project_id: projectId }),
    supabase.rpc("analytics_summary", { p_project_id: projectId }),
  ]);

  const summaryRow = Array.isArray(summary.data) ? summary.data[0] : summary.data;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <h1 className="text-xl font-semibold">Analytics</h1>
      <p className="text-muted-foreground text-xs">
        Cycle time evaluates each task&apos;s column against the board&apos;s current workflow, not the
        workflow that was in place on that historical date.
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Open" value={String(summaryRow?.total_open ?? 0)} />
        <StatTile label="Done" value={String(summaryRow?.total_done ?? 0)} />
        <StatTile label="Overdue" value={String(summaryRow?.overdue_count ?? 0)} />
        <StatTile
          label="Avg cycle time"
          value={summaryRow?.avg_cycle_hours ? `${Math.round(summaryRow.avg_cycle_hours)}h` : "—"}
        />
      </div>
      <ChartErrorBoundary label="Throughput">
        <ThroughputChart
          data={(throughput.data ?? []).map((r: { week_start: string; completed_count: number }) => ({
            weekStart: r.week_start,
            completedCount: r.completed_count,
          }))}
        />
      </ChartErrorBoundary>
      <ChartErrorBoundary label="Cycle time">
        <CycleTimeChart
          data={(cycleTime.data ?? []).map(
            (r: { week_start: string; sample_size: number; median_hours: number | null; p25_hours: number | null; p75_hours: number | null }) => ({
              weekStart: r.week_start,
              sampleSize: r.sample_size,
              medianHours: r.median_hours,
              p25Hours: r.p25_hours,
              p75Hours: r.p75_hours,
            }),
          )}
        />
      </ChartErrorBoundary>
      <ChartErrorBoundary label="Cumulative flow">
        <CumulativeFlowChart
          data={(flow.data ?? []).map((r: { snapshot_date: string; column_id: string; column_name: string; task_count: number }) => ({
            snapshotDate: r.snapshot_date,
            columnId: r.column_id,
            columnName: r.column_name,
            taskCount: r.task_count,
          }))}
        />
      </ChartErrorBoundary>
      <ChartErrorBoundary label="Workload">
        <WorkloadChart
          data={(workload.data ?? []).map((r: { member_user_id: string; display_name: string; open_count: number; done_count: number }) => ({
            memberUserId: r.member_user_id,
            displayName: r.display_name,
            openCount: r.open_count,
            doneCount: r.done_count,
          }))}
        />
      </ChartErrorBoundary>
    </div>
  );
}
```

A date-range selector (12/26/52 weeks) is a client component wrapping the same fetches via the routes from Task 2G.2 rather than the server-rendered RPC calls above — add `src/components/analytics/range-selector.tsx` (a `<select>` writing `?weeks=` to the URL, read by the page via `searchParams`) following the same URL-state pattern as the filter bar introduced in 2E.1; not spelled out call-by-call here since it is a direct repetition of that established pattern.

- [ ] **Step 10: Run full checks and commit**

Run: `npm run test && npm run typecheck && npm run lint && npm run build && npm run size`
Expected: all PASS; if the board-route bundle budget is tight, dynamic-`import()` the Recharts-based components on the analytics route only (they are not part of the board bundle already).

```bash
git add src/app/\(app\)/p/\[projectId\]/analytics src/components/analytics
git commit -m "feat(analytics): add the analytics dashboard UI"
```

---

### Task 2G.4 — Purge job (M5) + retention

**Files:**
- Create: `supabase/migrations/202609190003_purge_soft_deleted.sql`, `src/test/rls/purge.test.ts`

**Interfaces:**
- Produces RPC `purge_soft_deleted() returns void` (`service_role` only, `pg_cron` daily 03:00 UTC).

**Security properties:** unreachable from any browser session (granted to `service_role` only, same as `board_snapshot()`); never touches `activity` (the audit trail is permanent — `04 §4.10`); every delete is scoped by an explicit age predicate, never a blanket `delete from`.

- [ ] **Step 1: Failing fixture test**

```ts
// src/test/rls/purge.test.ts
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

describe("purge_soft_deleted() (2G.4)", () => {
  it("hard-deletes only rows past retention, leaves fresh rows and activity untouched", async () => {
    const admin = createAdminClient();
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const fresh = new Date(Date.now() - 1 * 86_400_000).toISOString();

    const { data: oldTask } = await admin
      .from("tasks")
      .insert({ project_id: f.projectId, column_id: f.columnId, title: "old-deleted", created_by: f.aId, position: Math.random(), deleted_at: old })
      .select("id")
      .single();
    const { data: freshTask } = await admin
      .from("tasks")
      .insert({ project_id: f.projectId, column_id: f.columnId, title: "fresh-deleted", created_by: f.aId, position: Math.random(), deleted_at: fresh })
      .select("id")
      .single();

    await admin.from("idempotency_keys").insert({
      user_id: f.aId,
      key: "old-key",
      request_hash: "h",
      status: 201,
      response: {},
      created_at: new Date(Date.now() - 25 * 3600_000).toISOString(),
    });

    const activityCountBefore = await admin.from("activity").select("id", { count: "exact", head: true }).eq("project_id", f.projectId);

    const { error } = await admin.rpc("purge_soft_deleted");
    expect(error).toBeNull();

    const oldTaskAfter = await admin.from("tasks").select("id").eq("id", oldTask!.id).maybeSingle();
    expect(oldTaskAfter.data).toBeNull();

    const freshTaskAfter = await admin.from("tasks").select("id").eq("id", freshTask!.id).maybeSingle();
    expect(freshTaskAfter.data).not.toBeNull();

    const oldKeyAfter = await admin.from("idempotency_keys").select("key").eq("user_id", f.aId).eq("key", "old-key").maybeSingle();
    expect(oldKeyAfter.data).toBeNull();

    const activityCountAfter = await admin.from("activity").select("id", { count: "exact", head: true }).eq("project_id", f.projectId);
    expect(activityCountAfter.count).toBe(activityCountBefore.count);
  });

  it("is idempotent — running twice in a row does not error", async () => {
    const admin = createAdminClient();
    const first = await admin.rpc("purge_soft_deleted");
    const second = await admin.rpc("purge_soft_deleted");
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/purge.test.ts`
Expected: FAIL — `purge_soft_deleted()` does not exist.

- [ ] **Step 3: Migration**

```sql
-- supabase/migrations/202609190003_purge_soft_deleted.sql
-- Retention (M5): 30 days for soft-deleted project/task/column/comment rows
-- (matches the trash-restore window from Task 2C.5), 7 days for sent
-- notification-queue rows, 90 days for read notifications, 30 days for
-- expired invitations, 24 hours for idempotency keys (T3). `activity` is
-- never purged — it is the permanent audit trail (04 §4.10).
--
-- Tables referenced below (comments, notification_queue, notifications) are
-- assumed to already exist from Sub-plans 2D/2F per the roadmap's build
-- order; the `to_regclass` guards make each block a no-op rather than an
-- error if a given table isn't present yet in an environment that runs this
-- migration out of order.
create or replace function public.purge_soft_deleted() returns void
language plpgsql security definer set search_path = public as $$
declare
  run_key text := to_char(now(), 'YYYY-MM-DD');
begin
  insert into public.job_runs (job_name, run_key, started_at)
  values ('purge_soft_deleted', run_key, now())
  on conflict (job_runs.job_name, job_runs.run_key) do nothing;

  delete from public.tasks where tasks.deleted_at is not null and tasks.deleted_at < now() - interval '30 days';
  delete from public.columns where columns.deleted_at is not null and columns.deleted_at < now() - interval '30 days';
  delete from public.projects where projects.deleted_at is not null and projects.deleted_at < now() - interval '30 days';

  if to_regclass('public.comments') is not null then
    execute 'delete from public.comments where deleted_at is not null and deleted_at < now() - interval ''30 days''';
  end if;

  delete from public.invitations
  where invitations.accepted_at is null
    and invitations.declined_at is null
    and invitations.expires_at < now() - interval '30 days';

  delete from public.idempotency_keys where idempotency_keys.created_at < now() - interval '24 hours';

  if to_regclass('public.notification_queue') is not null then
    execute 'delete from public.notification_queue where sent_at is not null and sent_at < now() - interval ''7 days''';
  end if;

  if to_regclass('public.notifications') is not null then
    execute 'delete from public.notifications where read_at is not null and read_at < now() - interval ''90 days''';
  end if;

  update public.job_runs set finished_at = now(), error = null
  where job_runs.job_name = 'purge_soft_deleted' and job_runs.run_key = run_key;
exception when others then
  update public.job_runs set finished_at = now(), error = sqlerrm
  where job_runs.job_name = 'purge_soft_deleted' and job_runs.run_key = run_key;
  raise;
end;
$$;
revoke all on function public.purge_soft_deleted() from public;
grant execute on function public.purge_soft_deleted() to service_role;

select cron.schedule('purge-soft-deleted-daily', '0 3 * * *', $$select public.purge_soft_deleted()$$);
```

- [ ] **Step 4: Apply and run the RLS suite**

Run: `npm run db:push` then `npm run test:rls -- src/test/rls/purge.test.ts`.
Expected: PASS.

- [ ] **Step 5: Run full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint`
Expected: all PASS.

```bash
git add supabase/migrations/202609190003_purge_soft_deleted.sql src/test/rls/purge.test.ts
git commit -m "feat(hardening): add the daily purge job with per-table retention windows"
```

---

## Verification (this file's tasks)

- **Per task:** `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build` green.
- **Before Task 2G.5 (next file):** `board_snapshots` has at least one row per project (Task 2G.1's test proves the job runs and is idempotent); every analytics route returns `sampleSize` and a `Cache-Control: private, max-age=300` header; the purge job has been run at least once against `kanbo-dev` with the fixture from Task 2G.4 and confirmed `activity` row counts are unchanged.

Continue with `2G-analytics-hardening-2.md` for Task 2G.5 (account deletion) through Task 2G.7 (production launch) — the tasks that close out the MVP.

# Kanbo Sub-plan 2C (Part 2) — Board completion: Tasks 2C.5–2C.7

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Complete `2C-board-completion-1.md` (Tasks 2C.1–2C.4) first — this file's tasks assume `board.tsx`/`column.tsx`/`task-card.tsx`/`task-editor.tsx` already exist (not `project-board.tsx`), that `update_task` already takes `p_assignee_id` and `p_expected_updated_at`, and that `job_runs` (Task 2C.2) already exists.
>
> **Read first:** `00-master-roadmap.md` §2 Gap Register, §4 Cross-cutting rules; `2B-members-invitations.md` Global Constraints (the ambiguous-column bug, repeated below); Part 1's Global Constraints section (identical, repeated here so this file is self-contained). Every task here consumes `withApiHandler`/`mapRpcError` (`src/lib/api/handler.ts`), `RATE_LIMITS` (`src/lib/api/rate-limit.ts`), `createAdminClient` (`src/lib/supabase/admin.ts`), `seedIsolationFixture` (`src/test/rls/setup.ts`), `log` (`src/lib/log.ts`).

**Goal:** Finish the P0 board surface — soft-deleted tasks are recoverable for 30 days, columns can be reordered and deleted with an explicit choice about their tasks, WIP limits are visible without relying on colour alone, unsaved task creates survive a network failure, and a notification/digest deep link opens the right task.

**Spec:** `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md` + `docs/specs/00`–`07`; `00-master-roadmap.md` §5 Sub-plan 2C.

**Definition of done (whole sub-plan 2C):** every task's acceptance tests green; every new table covered by the RLS isolation suite; `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build && npm run size` green; preview deployment on staging exercised manually; CI green on the PR.

## Global Constraints

- **The ambiguous-column bug (do not reintroduce it):** any `security definer` plpgsql function that declares `returns table (id uuid, ...)` (or any OUT-parameter name that also happens to be a table column — `position`, `role`, `email`, `deleted_at`, etc.) creates a variable of that name in scope for the whole function body. An unqualified `where id = p_x` inside that body is ambiguous between the OUT parameter and the table column, and Postgres raises `column reference "X" is ambiguous` on every call. This already broke seven RPCs in this repo (see `2B-members-invitations.md` Global Constraints for the list). **`restore_task`, `move_column`, and `delete_column` in this file all return tables with columns named `id`/`position` — qualify every bare reference inside their bodies with the table name or an explicit alias.** Unit tests will not catch this; only `npm run test:rls` against a real Supabase project does.
- TypeScript strict; no `any` in application code.
- No Docker locally. Apply migrations via `npm run db:push`, or the Supabase MCP `apply_migration` tool against `kanbo-dev` — either way, run `npm run test:rls` against the same project afterward.
- Every migration file: `supabase/migrations/YYYYMMDDNNNN_<name>.sql`, forward-only — never edit an applied migration; ship a new one.
- Every new/changed RPC: `security definer`, `set search_path = public`, `revoke all … from public`, explicit `grant execute` to the minimum role.
- Every new table: RLS enabled + forced, deny by default, explicit policies, added to the RLS integration suite in the same task.
- Every project-scoped write: non-members get **404**; members without sufficient role get **403**.
- `SUPABASE_SERVICE_ROLE_KEY` only via `createAdminClient()`.
- Structured JSON logs via `log()`; never log task titles/descriptions above `debug`.
- Commit at the end of every task: Conventional Commits, **no `Co-Authored-By` or `Claude-Session` trailers**. Before each commit: `git status`, inspect the diff, no secrets, `npm run test`, `npm run typecheck`, `npm run lint`.
- No colour-only signalling (`01 §23`): every state that uses colour (WIP-at-limit, overdue, priority) must also carry an icon or text label. The existing card already does this for priority/overdue (Task 2C.1's `task-card.tsx`); the WIP badge in Task 2C.6 follows the same rule.

---

## File Structure

```
supabase/migrations/202609200001_restore_task.sql                  Task 2C.5
supabase/migrations/202609200002_tasks_member_read_deleted.sql     Task 2C.5
src/app/api/v1/tasks/[taskId]/restore/route.ts                     Task 2C.5
src/app/(app)/p/[projectId]/trash/page.tsx                         Task 2C.5
src/components/board/trash-list.tsx                                  Task 2C.5
src/test/rls/board-restore.test.ts                                   Task 2C.5
supabase/migrations/202609200003_column_reorder_delete.sql         Task 2C.6
src/app/api/v1/projects/[projectId]/columns/[columnId]/position/route.ts   Task 2C.6
src/app/api/v1/projects/[projectId]/columns/[columnId]/route.ts    Task 2C.6 (modify — DELETE gains p_move_tasks_to)
src/lib/columns/schemas.ts                                          Task 2C.6
src/components/board/column-header.tsx                              Task 2C.6 (extracted from column.tsx — sortable header + delete dialog)
src/components/board/delete-column-dialog.tsx                       Task 2C.6
src/components/board/use-column-dnd.ts                              Task 2C.6
src/test/rls/board-columns.test.ts                                   Task 2C.6
src/components/board/task-composer.tsx                              Task 2C.7 (modify — retry-on-failure)
src/components/board/board.tsx                                       Task 2C.7 (modify — deep-link handling already added in 2C.1 Step 14; this task adds card counts to the server query)
src/app/(app)/p/[projectId]/board/page.tsx                          Task 2C.7 (modify — subtasks(count) join)
src/components/board/task-composer.test.tsx                          Task 2C.7
src/components/board/board.test.tsx                                  Task 2C.7 (extended — deep link test)
```

---

### Task 2C.5 — Task restore + trash

**Files:**
- Create: `supabase/migrations/202609200001_restore_task.sql`, `supabase/migrations/202609200002_tasks_member_read_deleted.sql`, `src/app/api/v1/tasks/[taskId]/restore/route.ts`, `src/app/(app)/p/[projectId]/trash/page.tsx`, `src/components/board/trash-list.tsx`, `src/test/rls/board-restore.test.ts`

**Interfaces:**
- Produces: `restore_task(p_task_id uuid) returns table (id uuid, column_id uuid, title varchar, position double precision)` — raises `P0002` if the task doesn't exist or the caller isn't a member, `P0003` (→ 410 GONE, already mapped in `RPC_ERROR_MAP`) if `deleted_at < now() - interval '30 days'` (i.e. it is past the retention window the purge job will eventually claim in 2G.4); on success, clears `deleted_at`, re-derives a fresh position at the end of its original column (its old position may now collide with newer tasks), and writes a `restored` activity row (the `activity_action` enum already has `restored`, `202609090001_data_core.sql:7`).
- New RLS policy `tasks_member_read_deleted` — project members may `select` their project's tasks with `deleted_at is not null and deleted_at > now() - interval '30 days'`, so the trash page can list them directly through the browser client (no new route needed for listing).
- Route: `POST /api/v1/tasks/[taskId]/restore` (no body).

- [ ] **Step 1: Write the failing RLS test**

```ts
// src/test/rls/board-restore.test.ts
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

describe("tasks_member_read_deleted (trash view)", () => {
  it("a member sees a recently-deleted task; a non-member sees nothing", async () => {
    await f.a.rpc("soft_delete_task", { p_task_id: f.taskId });
    const { data: memberView } = await f.a.from("tasks").select("id").eq("id", f.taskId);
    expect(memberView).toHaveLength(1);
    const { data: nonMemberView } = await f.b.from("tasks").select("id").eq("id", f.taskId);
    expect(nonMemberView).toHaveLength(0);
  });
});

describe("restore_task", () => {
  it("clears deleted_at, re-derives a position, and writes a 'restored' activity row", async () => {
    const { data, error } = await f.a.rpc("restore_task", { p_task_id: f.taskId });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.id).toBe(f.taskId);

    const { data: taskRow } = await f.a.from("tasks").select("deleted_at").eq("id", f.taskId).single();
    expect(taskRow?.deleted_at).toBeNull();

    const { data: activityRows } = await f.a.from("activity").select("action").eq("task_id", f.taskId).eq("action", "restored");
    expect(activityRows).toHaveLength(1);
  });

  it("raises P0003 (410 GONE) for a task deleted more than 30 days ago", async () => {
    const admin = createAdminClient();
    await f.a.rpc("soft_delete_task", { p_task_id: f.taskId });
    await admin.from("tasks").update({ deleted_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() }).eq("id", f.taskId);
    const { error } = await f.a.rpc("restore_task", { p_task_id: f.taskId });
    expect(error?.code).toBe("P0003");
  });

  it("a non-member gets P0002, not P0003, regardless of deletion age", async () => {
    const { error } = await f.b.rpc("restore_task", { p_task_id: f.taskId });
    expect(error?.code).toBe("P0002");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/board-restore.test.ts`
Expected: FAIL — no `tasks_member_read_deleted` policy (members currently only see `deleted_at is null` rows per `tasks_member_read`), `restore_task` does not exist.

- [ ] **Step 3: RLS policy migration**

```sql
-- supabase/migrations/202609200002_tasks_member_read_deleted.sql
-- Lets the trash page (2C.5) query deleted tasks directly through the
-- browser client, scoped to the 30-day retention window the purge job
-- (2G.4) will eventually enforce. The existing tasks_member_read policy is
-- untouched — this is an additive OR, not a replacement, so the board's
-- normal "deleted_at is null" queries are unaffected.
create policy tasks_member_read_deleted on public.tasks for select using (
  deleted_at is not null
  and deleted_at > now() - interval '30 days'
  and public.is_project_member(project_id)
);
```

- [ ] **Step 4: `restore_task` migration**

```sql
-- supabase/migrations/202609200001_restore_task.sql
create or replace function public.restore_task(p_task_id uuid)
returns table (id uuid, column_id uuid, title varchar, "position" double precision)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_task public.tasks%rowtype;
  new_position double precision;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;

  select * into existing_task from public.tasks
    where tasks.id = p_task_id and tasks.deleted_at is not null for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_project_member(existing_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(existing_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if existing_task.deleted_at < now() - interval '30 days' then
    raise exception 'TASK_GONE' using errcode = 'P0003';
  end if;
  -- The task's column may itself have been soft-deleted or hard-removed
  -- while it sat in the trash (delete-with-choice, 2C.6); fall back to the
  -- project's first surviving column rather than resurrecting a task into a
  -- column that no longer accepts writes.
  if not exists (select 1 from public.columns where columns.id = existing_task.column_id and columns.deleted_at is null) then
    select columns.id into existing_task.column_id from public.columns
      where columns.project_id = existing_task.project_id and columns.deleted_at is null
      order by columns.position limit 1;
    if existing_task.column_id is null then raise exception 'NO_COLUMNS_AVAILABLE' using errcode = '22023'; end if;
  end if;

  select coalesce(max(tasks.position), 0) + 1000 into new_position
    from public.tasks where tasks.column_id = existing_task.column_id and tasks.deleted_at is null;

  update public.tasks set deleted_at = null, column_id = existing_task.column_id, position = new_position
    where tasks.id = p_task_id returning * into existing_task;

  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, to_value)
  values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id, 'restored', jsonb_build_object('title', existing_task.title));

  return query select existing_task.id, existing_task.column_id, existing_task.title, existing_task.position;
end;
$$;
revoke all on function public.restore_task(uuid) from public;
grant execute on function public.restore_task(uuid) to authenticated;
```

- [ ] **Step 5: Apply and run the RLS suite**

Run: `npm run db:push` (or MCP `apply_migration`), then `npm run test:rls`.
Expected: PASS, including `board-restore.test.ts`.

- [ ] **Step 6: Route**

```ts
// src/app/api/v1/tasks/[taskId]/restore/route.ts
import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid() }),
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to restore tasks.",
  },
  async ({ supabase, params, requestId }) => {
    const { data, error } = await supabase.rpc("restore_task", { p_task_id: params.taskId });
    if (error)
      return mapRpcError(error, { message: "Task could not be restored.", requestId, projectScoped: true });
    const task = firstRow(data);
    if (!task) return apiError(500, "INTERNAL_ERROR", "Task restore returned no task.", { requestId });
    return json({ data: task });
  },
);
```

- [ ] **Step 7: Trash page + component**

```tsx
// src/app/(app)/p/[projectId]/trash/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { TrashList } from "@/components/board/trash-list";

export default async function TrashPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const [{ data: project }, { data: membership }] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", projectId).is("deleted_at", null).maybeSingle(),
    supabase.from("memberships").select("role").eq("project_id", projectId).maybeSingle(),
  ]);
  // Owner/Admin/Member per the acceptance criteria — Viewer is read-only
  // everywhere else on the board, and restoring is a write.
  if (!project || !membership || membership.role === "viewer") notFound();

  const { data: deletedTasks } = await supabase
    .from("tasks")
    .select("id, title, column_id, deleted_at")
    .eq("project_id", projectId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link href={`/p/${projectId}/board`} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-3.5" /> Board
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Trash</h1>
      <p className="text-muted-foreground mt-1 text-sm">Deleted tasks are kept for 30 days.</p>
      <TrashList projectId={projectId} initialTasks={deletedTasks ?? []} />
    </main>
  );
}
```

```tsx
// src/components/board/trash-list.tsx
"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";

type DeletedTask = { id: string; title: string; column_id: string; deleted_at: string };

export function TrashList({ initialTasks }: { projectId: string; initialTasks: DeletedTask[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore(taskId: string) {
    setError(null);
    setPendingId(taskId);
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/restore`, { method: "POST" });
      if (response.status === 410) {
        setError("This task can no longer be restored — it was deleted more than 30 days ago.");
        setTasks((current) => current.filter((task) => task.id !== taskId));
        return;
      }
      if (!response.ok) throw new Error("restore failed");
      setTasks((current) => current.filter((task) => task.id !== taskId));
    } catch {
      setError("Task could not be restored. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  if (tasks.length === 0) {
    return <p className="text-muted-foreground mt-8 text-sm">Nothing in the trash.</p>;
  }

  return (
    <ul className="mt-6 divide-y rounded-lg border">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{task.title}</p>
            <p className="text-muted-foreground text-xs">Deleted {formatDistanceToNow(new Date(task.deleted_at), { addSuffix: true })}</p>
          </div>
          <Button size="sm" variant="outline" disabled={pendingId === task.id} onClick={() => void restore(task.id)}>
            {pendingId === task.id ? "Restoring" : "Restore"}
          </Button>
        </li>
      ))}
      {error && <p role="alert" className="text-destructive px-4 py-2 text-sm">{error}</p>}
    </ul>
  );
}
```

Add a "Trash" link to the board header (`src/app/(app)/p/[projectId]/board/page.tsx`, alongside the existing List/Settings/Activity links) visible to Owner/Admin/Member — reuse the same `membership?.role === "viewer"` check already in that file, inverted.

- [ ] **Step 8: Full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build`
Expected: all PASS.

```bash
git add supabase/migrations/202609200001_restore_task.sql supabase/migrations/202609200002_tasks_member_read_deleted.sql src/app/api/v1/tasks/\[taskId\]/restore src/app/\(app\)/p/\[projectId\]/trash src/components/board/trash-list.tsx src/test/rls/board-restore.test.ts src/app/\(app\)/p/\[projectId\]/board/page.tsx
git commit -m "feat(board): add task restore and a 30-day trash view"
```

---

### Task 2C.6 — Column reorder, delete-with-choice, WIP indicator

**Files:**
- Create: `supabase/migrations/202609200003_column_reorder_delete.sql`, `src/app/api/v1/projects/[projectId]/columns/[columnId]/position/route.ts`, `src/lib/columns/schemas.ts`, `src/components/board/column-header.tsx`, `src/components/board/delete-column-dialog.tsx`, `src/components/board/use-column-dnd.ts`, `src/test/rls/board-columns.test.ts`
- Modify: `src/app/api/v1/projects/[projectId]/columns/[columnId]/route.ts` (DELETE gains `p_move_tasks_to`), `src/components/board/board.tsx` (wrap column headers in a second `DndContext`... actually reuses the same one — see Step 8), `src/components/board/column.tsx` (render `ColumnHeader` instead of the inline `<header>`)

**Interfaces:**
- Produces:
  ```sql
  move_column(p_column_id uuid, p_position double precision) returns table (id uuid, "position" double precision)
  delete_column(p_column_id uuid, p_move_tasks_to uuid) returns void
  -- p_move_tasks_to = the column's own id (a sentinel, since uuid has no
  -- natural "null means soft-delete" without an extra bool) means "soft-
  -- delete the column's open tasks"; any other column id means "move them
  -- there"; refuses if p_column_id is the project's only column, or is the
  -- done column and holds undeleted tasks with p_move_tasks_to unset.
  ```
- Consumes: `computeDropPosition` (Task 2C.1, reused for column reordering — same fractional-index math applies to columns' `position` column) and `renormalize_column`-equivalent reasoning (columns don't get their own renormalisation function in this task; 3–8 columns per project never approaches the float-precision floor the way 500 tasks can, so this is deliberately out of scope — flagged here as a judgment call, not an oversight).

**Acceptance:** dropping a card into a column deleted mid-drag returns `22023` (422) from `move_task`'s existing `INVALID_COLUMN` check (unchanged — this task adds no new failure mode there, the check already exists in `202609190001_renormalize_positions.sql`'s `move_task` body) → the card reverts and a toast shows (`01 §23`); a WIP-limited column shows `n/limit` with a warning icon, not colour alone, once `n >= limit`.

- [ ] **Step 1: Write the failing RLS test**

```ts
// src/test/rls/board-columns.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let f: IsolationFixture;
let secondColumnId: string;
let doneColumnId: string;
beforeAll(async () => {
  f = await seedIsolationFixture();
  const { data: columns } = await f.a.from("columns").select("id, is_done_column").eq("project_id", f.projectId).order("position");
  secondColumnId = columns![1].id;
  doneColumnId = columns!.find((c) => c.is_done_column)!.id;
});
afterAll(async () => {
  await f.cleanup();
});

describe("move_column", () => {
  it("reorders columns and a non-member is rejected with P0002", async () => {
    const { error: nonMemberError } = await f.b.rpc("move_column", { p_column_id: secondColumnId, p_position: 0.5 });
    expect(nonMemberError?.code).toBe("P0002");

    const { data, error } = await f.a.rpc("move_column", { p_column_id: secondColumnId, p_position: 0.5 });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.position).toBe(0.5);
  });
});

describe("delete_column", () => {
  it("refuses to delete the project's only-surviving-of-three... actually refuses when it is the last column", async () => {
    const admin = createAdminClient();
    await admin.from("columns").update({ deleted_at: new Date().toISOString() }).in("id", [secondColumnId, doneColumnId]);
    const { data: remaining } = await f.a.from("columns").select("id").eq("project_id", f.projectId).is("deleted_at", null);
    const lastColumnId = remaining![0].id;
    const { error } = await f.a.rpc("delete_column", { p_column_id: lastColumnId, p_move_tasks_to: lastColumnId });
    expect(error?.code).toBe("22023");
    await admin.from("columns").update({ deleted_at: null }).in("id", [secondColumnId, doneColumnId]);
  });

  it("null-sentinel (own id) soft-deletes the column's open tasks; a target id moves them", async () => {
    const { data: columns } = await f.a.from("columns").select("id").eq("project_id", f.projectId).order("position");
    const sourceColumnId = columns![0].id;
    const targetColumnId = columns![1].id;

    const { error } = await f.a.rpc("delete_column", { p_column_id: sourceColumnId, p_move_tasks_to: targetColumnId });
    expect(error).toBeNull();
    const { data: task } = await f.a.from("tasks").select("column_id, deleted_at").eq("id", f.taskId).single();
    expect(task?.column_id).toBe(targetColumnId);
    expect(task?.deleted_at).toBeNull();
    const { data: columnRow } = await createAdminClient().from("columns").select("deleted_at").eq("id", sourceColumnId).single();
    expect(columnRow?.deleted_at).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/board-columns.test.ts`
Expected: FAIL — `move_column`/`delete_column` do not exist.

- [ ] **Step 3: Migration**

```sql
-- supabase/migrations/202609200003_column_reorder_delete.sql
create or replace function public.move_column(p_column_id uuid, p_position double precision)
returns table (id uuid, "position" double precision)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_column public.columns%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_column from public.columns where columns.id = p_column_id and columns.deleted_at is null for update;
  if not found then raise exception 'COLUMN_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_project_member(existing_column.project_id) then raise exception 'COLUMN_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.memberships where memberships.project_id = existing_column.project_id and memberships.user_id = current_user_id and memberships.role in ('owner', 'admin')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_position in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) then raise exception 'INVALID_POSITION' using errcode = '22023'; end if;

  update public.columns set "position" = p_position where columns.id = p_column_id returning * into existing_column;
  return query select existing_column.id, existing_column."position";
end;
$$;
revoke all on function public.move_column(uuid, double precision) from public;
grant execute on function public.move_column(uuid, double precision) to authenticated;

-- p_move_tasks_to = p_column_id itself is the "soft-delete the tasks too"
-- sentinel (uuid has no third natural state without an extra bool param;
-- this keeps the route's Zod schema a single required uuid field, matching
-- the two-choice delete dialog on the client 1:1).
create or replace function public.delete_column(p_column_id uuid, p_move_tasks_to uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_column public.columns%rowtype;
  target_column public.columns%rowtype;
  surviving_columns integer;
  open_task_count integer;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_column from public.columns where columns.id = p_column_id and columns.deleted_at is null for update;
  if not found then raise exception 'COLUMN_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_project_member(existing_column.project_id) then raise exception 'COLUMN_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.memberships where memberships.project_id = existing_column.project_id and memberships.user_id = current_user_id and memberships.role in ('owner', 'admin')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select count(*) into surviving_columns from public.columns where columns.project_id = existing_column.project_id and columns.deleted_at is null;
  if surviving_columns <= 1 then raise exception 'LAST_COLUMN' using errcode = '22023'; end if;

  select count(*) into open_task_count from public.tasks where tasks.column_id = p_column_id and tasks.deleted_at is null;

  if p_move_tasks_to <> p_column_id then
    select * into target_column from public.columns where columns.id = p_move_tasks_to and columns.project_id = existing_column.project_id and columns.deleted_at is null;
    if not found then raise exception 'INVALID_TARGET_COLUMN' using errcode = '22023'; end if;
    update public.tasks set column_id = p_move_tasks_to,
      "position" = "position" + (select coalesce(max(t2."position"), 0) from public.tasks t2 where t2.column_id = p_move_tasks_to and t2.deleted_at is null)
      where tasks.column_id = p_column_id and tasks.deleted_at is null;
  else
    update public.tasks set deleted_at = now() where tasks.column_id = p_column_id and tasks.deleted_at is null;
  end if;

  update public.columns set deleted_at = now() where columns.id = p_column_id;
  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value)
  values (existing_column.project_id, current_user_id, 'column', p_column_id, 'deleted',
    jsonb_build_object('name', existing_column.name, 'taskCount', open_task_count, 'movedTo', case when p_move_tasks_to <> p_column_id then p_move_tasks_to else null end));
end;
$$;
revoke all on function public.delete_column(uuid, uuid) from public;
grant execute on function public.delete_column(uuid, uuid) to authenticated;
```

- [ ] **Step 4: Apply and run the RLS suite**

Run: `npm run db:push` (or MCP `apply_migration`), then `npm run test:rls`.
Expected: PASS, including `board-columns.test.ts`.

- [ ] **Step 5: Zod schemas + routes**

```ts
// src/lib/columns/schemas.ts
import { z } from "zod";
import { finitePositionSchema, uuidSchema } from "@/lib/tasks/schemas";

export const moveColumnSchema = z.object({ position: finitePositionSchema });
export const deleteColumnSchema = z.object({ moveTasksTo: uuidSchema });
```

```ts
// src/app/api/v1/projects/[projectId]/columns/[columnId]/position/route.ts
import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { moveColumnSchema } from "@/lib/columns/schemas";

export const PATCH = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ projectId: z.string().uuid(), columnId: z.string().uuid() }),
    body: moveColumnSchema,
    notFoundMessage: "Column not found.",
    unauthenticatedMessage: "Sign in to reorder columns.",
    validationMessage: "Check where this column should move.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("move_column", {
      p_column_id: params.columnId,
      p_position: body.position,
    });
    if (error)
      return mapRpcError(error, { message: "Column could not be moved.", requestId, projectScoped: true });
    const column = firstRow(data);
    if (!column) return apiError(500, "INTERNAL_ERROR", "Column move returned no column.", { requestId });
    return json({ data: column });
  },
);
```

```ts
// src/app/api/v1/projects/[projectId]/columns/[columnId]/route.ts — DELETE handler, extended
export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ projectId: z.string().uuid(), columnId: z.string().uuid() }),
    body: deleteColumnSchema,
    notFoundMessage: "Column not found.",
    unauthenticatedMessage: "Sign in to delete columns.",
    validationMessage: "Choose where this column's tasks should go.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { error } = await supabase.rpc("delete_column", {
      p_column_id: params.columnId,
      p_move_tasks_to: body.moveTasksTo,
    });
    if (error)
      return mapRpcError(error, { message: "Column could not be deleted.", requestId, projectScoped: true });
    return new Response(null, { status: 204 });
  },
);
```

Note: `DELETE` with a Zod-validated JSON body is unusual but matches this route needing the two-choice decision atomically with the deletion — `withApiHandler`'s `options.body` parsing runs for any method, so this is a mechanical, not structural, change. The client always sends `moveTasksTo: columnId` itself as the soft-delete sentinel when the user picks "Delete these tasks too."

- [ ] **Step 6: `use-column-dnd.ts` — sortable column headers**

Column reordering reuses the same fractional-index approach as `computeDropPosition` (Task 2C.1), but over columns instead of tasks, and needs its own small hook because it responds to a different `DndContext` drag-item type (`"column"` vs `"task"`) inside the same `<DndContext>` `board.tsx` already renders — dnd-kit supports multiple sortable groups under one context as long as each draggable's `data.current.type` disambiguates it in `onDragEnd`.

```ts
// src/components/board/use-column-dnd.ts
"use client";

import { useCallback } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import { computeDropPosition } from "./compute-drop-position";
import type { BoardColumn } from "./board";

export function useColumnDnd(params: {
  columns: BoardColumn[];
  readOnly: boolean;
  onMove: (columnId: string, position: number) => void;
}) {
  const { columns, readOnly, onMove } = params;

  const onColumnDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (readOnly) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const sorted = [...columns].sort((a, b) => a.position - b.position);
      const fromIndex = sorted.findIndex((column) => column.id === active.id);
      const toIndex = sorted.findIndex((column) => column.id === over.id);
      if (fromIndex === -1 || toIndex === -1) return;
      const prev = sorted[toIndex - (toIndex > fromIndex ? 0 : 1)]?.position ?? null;
      const next = sorted[toIndex + (toIndex > fromIndex ? 1 : 0)]?.position ?? null;
      const position = computeDropPosition(
        toIndex === 0 ? null : prev,
        toIndex === sorted.length - 1 ? null : next,
      );
      onMove(String(active.id), position);
    },
    [columns, readOnly, onMove],
  );

  return { onColumnDragEnd };
}
```

`board.tsx`'s single `DndContext.onDragEnd` dispatches to `useBoardDnd`'s handler or `useColumnDnd`'s handler based on `event.active.data.current?.type === "column"` — add that one `if` branch at the top of the existing `onDragEnd` wiring in `board.tsx` (from Task 2C.1 Step 14), calling `moveColumn(columnId, position)` (a new `board.tsx` function mirroring `moveTask`, `PATCH`ing the new position route and reconciling optimistically, following the exact same try/catch/revert shape as `moveTask` — omitted here since it is a mechanical copy).

- [ ] **Step 7: `ColumnHeader` + `DeleteColumnDialog`**

```tsx
// src/components/board/column-header.tsx
"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BoardColumn } from "./board";

export function ColumnHeader({
  column,
  taskCount,
  readOnly,
  onRequestDelete,
}: {
  column: BoardColumn;
  taskCount: number;
  readOnly: boolean;
  onRequestDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: column.id,
    data: { type: "column" },
    disabled: readOnly,
  });
  const atWipLimit = column.wip_limit != null && taskCount >= column.wip_limit;

  return (
    <header
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...(readOnly ? {} : attributes)}
      {...(readOnly ? {} : listeners)}
      className="bg-card sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b px-4 py-3"
    >
      <div className="min-w-0">
        <h2 className="truncate font-semibold">{column.name}</h2>
        <p className={cn("mt-0.5 flex items-center gap-1 text-xs", atWipLimit ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
          {taskCount} {taskCount === 1 ? "task" : "tasks"}
          {column.wip_limit ? ` · WIP ${taskCount}/${column.wip_limit}` : ""}
          {atWipLimit && <TriangleAlert className="size-3" aria-label="At WIP limit" />}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {!readOnly && <Plus className="text-muted-foreground size-4" aria-hidden="true" />}
        {!readOnly && (
          <button
            type="button"
            onClick={onRequestDelete}
            aria-label={`Delete column ${column.name}`}
            className="text-muted-foreground hover:text-destructive focus-visible:ring-ring rounded p-1 text-xs focus-visible:ring-2 focus-visible:outline-none"
          >
            Delete
          </button>
        )}
      </div>
    </header>
  );
}
```

```tsx
// src/components/board/delete-column-dialog.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { BoardColumn } from "./board";

export function DeleteColumnDialog({
  column,
  otherColumns,
  taskCount,
  onCancel,
  onConfirm,
}: {
  column: BoardColumn;
  otherColumns: BoardColumn[];
  taskCount: number;
  onCancel: () => void;
  onConfirm: (moveTasksTo: string) => void;
}) {
  const [target, setTarget] = useState<string>("delete-tasks");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={onCancel}>
      <section role="dialog" aria-modal="true" aria-labelledby="delete-column-title" className="bg-card w-full max-w-md rounded-xl p-5 shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="delete-column-title" className="text-lg font-semibold">Delete &quot;{column.name}&quot;?</h2>
        {taskCount > 0 ? (
          <>
            <p className="text-muted-foreground mt-2 text-sm">This column has {taskCount} {taskCount === 1 ? "task" : "tasks"}. Choose what happens to them.</p>
            <fieldset className="mt-4 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="target" checked={target === "delete-tasks"} onChange={() => setTarget("delete-tasks")} />
                Delete these tasks too (recoverable from Trash for 30 days)
              </label>
              {otherColumns.map((candidate) => (
                <label key={candidate.id} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="target" checked={target === candidate.id} onChange={() => setTarget(candidate.id)} />
                  Move them to &quot;{candidate.name}&quot;
                </label>
              ))}
            </fieldset>
          </>
        ) : (
          <p className="text-muted-foreground mt-2 text-sm">This column is empty.</p>
        )}
        <div className="mt-5 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={() => onConfirm(target === "delete-tasks" ? column.id : target)}>
            Delete column
          </Button>
        </div>
      </section>
    </div>
  );
}
```

`column.tsx` (Task 2C.1) is updated to render `<ColumnHeader>` instead of its inline `<header>`, and `board.tsx` holds `deletingColumn: BoardColumn | null` state, rendering `<DeleteColumnDialog>` when set, calling `DELETE /api/v1/projects/:projectId/columns/:columnId` with `{ moveTasksTo }` on confirm and, on 422 (e.g. last column), showing a toast rather than closing the dialog.

- [ ] **Step 8: Drop-into-deleted-column revert test**

```tsx
// src/components/board/board.test.tsx — additional describe block, appended to the file from Task 2C.1
describe("drop into a column deleted mid-drag (01 §23)", () => {
  it("reverts the card and shows a toast on a 422 INVALID_COLUMN response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: { code: "VALIDATION_ERROR", message: "That column no longer exists." } }),
    }) as unknown as typeof fetch;

    render(
      <Board projectId="proj" currentUserId="u1" initialColumns={columns} initialTasks={tasks} readOnly={false} />,
    );
    const card = screen.getByRole("button", { name: /write plan/i }).closest("article")!;
    card.focus();
    const user = userEvent.setup();
    await user.keyboard(" ");
    await user.keyboard("{ArrowRight}");
    await user.keyboard(" ");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /write plan/i }).closest("article")).toHaveAttribute("data-column", "col-a");
    });
  });
});
```

This asserts the same revert path `moveTask` already implements (Task 2C.1's `catch` block resets `tasks` to the pre-optimistic value) — no new client logic is needed for the revert itself, only the toast. Add `data-column={task.column_id}` to `task-card.tsx`'s root `<article>` so the test can assert the reverted column without depending on DOM order, and call `toast.error(...)` (the existing `sonner` dependency, already used elsewhere per `package.json`) from `moveTask`'s `catch` block instead of only setting the `sr-only` `moveError` text.

- [ ] **Step 9: Run to verify it passes**

Run: `npx vitest run src/components/board`
Expected: PASS.

- [ ] **Step 10: Full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build`
Expected: all PASS.

```bash
git add supabase/migrations/202609200003_column_reorder_delete.sql src/app/api/v1/projects/\[projectId\]/columns src/lib/columns/schemas.ts src/components/board src/test/rls/board-columns.test.ts
git commit -m "feat(board): add column reorder, delete-with-choice, and a WIP indicator"
```

---

### Task 2C.7 — Unsaved-create retry, deep link, card counts

**Files:**
- Modify: `src/components/board/task-composer.tsx` (retry-on-failure), `src/components/board/board.tsx` (deep-link handling — already added in Task 2C.1 Step 14; this task only needs the server query change below to make `?task=` resolve to a task that actually carries subtask counts), `src/app/(app)/p/[projectId]/board/page.tsx` (`subtasks(count)` join)
- Create: `src/components/board/task-composer.test.tsx`

**Interfaces:**
- Modifies: `TaskComposer` keeps a locally-held "unsaved" card (`{ localId: string; title: string; columnId: string }`) when its `POST /api/v1/projects/:projectId/tasks` call fails on a network error (not a validation error — those still clear correctly since the title was genuinely rejected), rendered inline with a "Unsaved · Retry" affordance instead of vanishing; the board's tasks query gains `subtasks(count)` and `subtasks(count).filter(is_completed.eq.true)`-equivalent (Supabase's embedded-resource count syntax) so `task-card.tsx`'s existing `{task.subtask_completed_count}/{task.subtask_count}` (added in Task 2C.1 Step 14) renders real numbers instead of always `0/0`.

- [ ] **Step 1: Write the failing composer retry test**

```tsx
// src/components/board/task-composer.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskComposer } from "./task-composer";

describe("TaskComposer — unsaved-create retry (S1)", () => {
  it("keeps the card locally and offers Retry on a network failure, then clears it on a successful retry", async () => {
    const onCreated = vi.fn();
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return Promise.reject(new Error("offline"));
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { id: "t9", column_id: "col-a", title: "Ship it", position: 1000 } }),
      });
    }) as unknown as typeof fetch;

    render(<TaskComposer projectId="proj" columnId="col-a" onCreated={onCreated} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/new task in this column/i), "Ship it");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByText("Unsaved · Retry")).toBeInTheDocument());
    expect(screen.getByText("Ship it")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "t9" })));
    expect(screen.queryByText("Unsaved · Retry")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/board/task-composer.test.tsx`
Expected: FAIL — current `TaskComposer` (moved verbatim from `project-board.tsx` in Task 2C.1) clears `title` and shows a generic error text on any failure; it does not keep an unsaved card or a Retry affordance.

- [ ] **Step 3: Implement**

```tsx
// src/components/board/task-composer.tsx
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BoardTask } from "./board";

type UnsavedCard = { localId: string; title: string };

export function TaskComposer({
  projectId,
  columnId,
  onCreated,
  inputRef,
}: {
  projectId: string;
  columnId: string;
  onCreated: (task: BoardTask) => void;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [unsaved, setUnsaved] = useState<UnsavedCard | null>(null);

  async function submit(retryTitle?: string) {
    const trimmedTitle = (retryTitle ?? title).trim();
    if (!trimmedTitle) {
      setError("Add a task title first.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmedTitle, columnId }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isBoardTask(payload)) {
        // A real validation rejection (title too long, etc.) — the server
        // was reachable and said no, so there is nothing to retry: clear it
        // like before.
        setError("Task could not be saved. Your title is still here—try again.");
        return;
      }
      onCreated(payload.data);
      setTitle("");
      setUnsaved(null);
    } catch {
      // Network failure — the server was never reached, so the user's words
      // are not "rejected", they're "not yet sent" (S1). Keep the card.
      setUnsaved({ localId: crypto.randomUUID(), title: trimmedTitle });
      setTitle("");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border-t p-3">
      {unsaved && (
        <div className="bg-muted/60 mb-2 flex items-center justify-between gap-2 rounded-md border border-dashed p-2 text-sm">
          <span className="min-w-0 truncate">{unsaved.title}</span>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-muted-foreground text-xs">Unsaved · Retry</span>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void submit(unsaved.title)}>
              Retry
            </Button>
          </div>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor={`task-title-${columnId}`}>
          New task in this column
        </label>
        <textarea
          ref={inputRef}
          id={`task-title-${columnId}`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
            if (event.key === "Escape") {
              setTitle("");
              setError(null);
            }
          }}
          maxLength={200}
          disabled={pending}
          placeholder="Add a task…"
          rows={2}
          className="bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/40 w-full resize-none rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">Enter to add · Shift + Enter for a new line</p>
          <Button size="sm" type="submit" disabled={pending || title.trim().length === 0}>
            <Plus /> {pending ? "Adding" : "Add"}
          </Button>
        </div>
        {error && (
          <p className="text-destructive mt-2 text-sm" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

function isBoardTask(value: unknown): value is { data: BoardTask } {
  if (typeof value !== "object" || value === null || !("data" in value)) return false;
  const task = value.data;
  return typeof task === "object" && task !== null && "id" in task && "column_id" in task;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/board/task-composer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Deep-link test**

```tsx
// src/components/board/board.test.tsx — additional test, appended
import { useSearchParams as mockUseSearchParams } from "next/navigation";

describe("deep link (?task=, G14)", () => {
  it("opens the task editor for the task named in the query string on mount", () => {
    vi.mocked(mockUseSearchParams).mockReturnValue(new URLSearchParams("task=t1") as never);
    render(
      <Board projectId="proj" currentUserId="u1" initialColumns={columns} initialTasks={tasks} readOnly={false} />,
    );
    expect(screen.getByRole("dialog", { name: /edit task/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Write plan")).toBeInTheDocument();
  });
});
```

This exercises the `useEffect` reading `searchParams.get("task")` already added to `board.tsx` in Task 2C.1 Step 14 — no new client code is needed here, only the query change in the next step and this test proving the wiring holds end to end now that real data (subtask counts) flows through it.

Run: `npx vitest run src/components/board/board.test.tsx`
Expected: PASS (this specific `it` was already satisfiable by 2C.1's code; it is written here, not in 2C.1, because it depends on nothing new — listing it in 2C.1 would have been equally valid, but grouping the deep-link acceptance criterion with the rest of "G14" here keeps this task's acceptance list self-contained per the task-level plan in `2C-board-completion.md`).

- [ ] **Step 6: Card counts — server query**

```ts
// src/app/(app)/p/[projectId]/board/page.tsx — tasks select, final form combining 2C.3's assignee join
supabase
  .from("tasks")
  .select(
    "id, column_id, title, description, due_date, priority, position, assignee_id, created_at, updated_at, assignee:project_peers(display_name), subtasks(count)",
  )
  .eq("project_id", projectId)
  .is("deleted_at", null)
  .order("position"),
```

PostgREST's `subtasks(count)` returns `[{ count: number }]` for the *total* subtask count; there is no built-in embedded "count where completed" in one round trip without a second aggregate, so completed counts are fetched with a second lightweight query and merged client-side to avoid a bespoke SQL view for a single board-load concern:

```ts
// src/app/(app)/p/[projectId]/board/page.tsx — after the Promise.all, before shaping `tasks`
const { data: completedCounts } = await supabase
  .from("subtasks")
  .select("task_id")
  .eq("is_completed", true)
  .in("task_id", (taskData ?? []).map((row) => row.id));
const completedByTask = new Map<string, number>();
for (const row of completedCounts ?? []) {
  completedByTask.set(row.task_id, (completedByTask.get(row.task_id) ?? 0) + 1);
}

const tasks = (taskData ?? []).map((row) => ({
  ...row,
  assignee_display_name: Array.isArray(row.assignee) ? row.assignee[0]?.display_name : row.assignee?.display_name,
  subtask_count: Array.isArray(row.subtasks) ? (row.subtasks[0]?.count ?? 0) : 0,
  subtask_completed_count: completedByTask.get(row.id) ?? 0,
})) as BoardTask[];
```

Judgment call: an `.in("task_id", ids)` query with the board's task list is bounded by A1 (<500 tasks per project, `00-master-roadmap.md` G10), so this two-query approach stays well inside the page's latency budget without needing a dedicated SQL view; revisit if A1 is ever revalidated upward.

- [ ] **Step 7: Full checks and commit**

Run: `npm run test && npm run typecheck && npm run lint && npm run build && npm run size`
Expected: all PASS.

```bash
git add src/components/board/task-composer.tsx src/components/board/task-composer.test.tsx src/components/board/board.test.tsx src/app/\(app\)/p/\[projectId\]/board/page.tsx
git commit -m "feat(board): keep unsaved task creates locally and show subtask progress"
```

---

## Verification (sub-plan exit)

See `00-master-roadmap.md` §6.

- **Per task:** `npm run test`, `npm run typecheck`, `npm run lint`; `npm run test:rls` for any task with a migration (2C.2, 2C.3, 2C.4, 2C.5, 2C.6); `npm run build`; `npm run size` (board route budget, T13/`01 §25`: < 250 KB gz — dnd-kit's added weight from Task 2C.1 is the main risk here, check this explicitly after 2C.1).
- **Sub-plan exit (whole of 2C, Parts 1 and 2):**
  - Preview deploy on staging.
  - Playwright flows from `00-master-roadmap.md` §6 relevant to this sub-plan: J2 (comment → drag → done — the drag leg is exercised now; the comment leg lands in 2D) and the mouse-drag spec from Task 2C.1 (`e2e/board-drag.spec.ts`).
  - Two-browser realtime check: drag a card in one browser, confirm the other reflects the move within the sync grace window (`src/lib/realtime/board-sync.ts`'s `MUTATION_ECHO_TTL_MS`/`SYNC_GRACE_MS`, unchanged by this sub-plan); delete a column with tasks in one browser, confirm the other's board updates (tasks move/disappear) live.
  - Manual accessibility pass: full keyboard-only run through create → drag (keyboard) → edit → assign → delete → restore, no mouse; `prefers-reduced-motion: reduce` verified to disable card and column drag animations; screen-reader smoke test (VoiceOver or NVDA) on the live-region announcements during a keyboard drag.
  - `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build && npm run size` green on the final commit of the sub-plan.
  - Confirm `job_runs` (Task 2C.2) has at least one successful `renormalize_positions` row on staging before calling 2C done — this table and its writer are reused unchanged by every `pg_cron` job from 2F onward, so a broken writer here would silently break idempotency tracking for the rest of the roadmap.

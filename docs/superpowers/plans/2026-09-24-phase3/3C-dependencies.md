# 3C Task Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a task be marked "blocked by" other tasks in the same project. The UI shows a Blocked badge while any blocker is open and warns before a blocked task is started or completed. When a task's last open blocker is completed, the assignee is notified.

**Architecture:**
- A `task_dependencies` edge table, read through RLS.
- `security definer` RPCs for add and remove. They enforce same-project, role, cap, duplicate and cycle rules, and write activity entries.
- A `security invoker` read RPC returns one task's "blocked by" and "blocking" lists.
- An AFTER UPDATE trigger on `tasks.column_id` enqueues `blocker_resolved` notifications through the existing `enqueue_notifications`.
- The board and list pages load the project's edges once. Whether a blocker is open is computed on the client from live task and column state, so realtime moves update badges without a refetch.
- `calendar_tasks` gains `open_blocker_count`.
- The warning is a confirm dialog in the board's single `moveTask` path. `move_task` itself is unchanged.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (plpgsql, PostgREST, triggers), zod 3, radix Dialog (`src/components/ui/dialog.tsx`), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-24-calendar-links-dependencies-design.md` (section "3C Dependencies").

**Depends on:** 3A and 3B are merged into this branch first. This plan redefines `calendar_tasks` from 3A, and it edits the same drawer, card and row code as 3A and 3B.

## Global Constraints

- **Warn, don't block.** `move_task` is not modified. The only enforcement is the client confirm dialog.
- An **open blocker** is a blocker task that is not deleted and whose column is not `is_done_column`.
- **Warning trigger:** moving a task that has at least one open blocker from its current column into a column with `is_in_progress_column` or `is_done_column`. Reordering within the same column never warns.
- **Rules:**
  - Both tasks are in the same project.
  - The caller needs `can_write_project`.
  - No self-links.
  - No duplicates (`23505`).
  - No cycles, raised with the distinct SQLSTATE **`P0005`**.
  - At most **20** blockers per blocked task.
- **Notification:**
  - Type `blocker_resolved`, which maps to the existing `status_change` preference category.
  - The recipient is the blocked task's assignee.
  - It is sent only when the blocked task's open-blocker count drops to zero because a blocker entered the done column.
  - It is never sent to the actor. `enqueue_notifications` already excludes the actor.
- Activity actions are `dependency_added` and `dependency_removed`, recorded on the blocked task with `entity_type` `'task_dependency'`.
- Enum values ship in their own migration (see `202609210001_activity_action_commented.sql`). Migrations are numbered `202610040001`–`202610040004`. Apply them with `npx supabase db push` (approved by the user for additive migrations). `202610040004` drops and recreates `calendar_tasks`; that is allowed because the function has no dependants. Never use `db reset`.
- No new npm dependencies. Commits carry **no** `Co-Authored-By` or `Claude-Session` trailers.
- Test fixture status (observation 0008): none of this plan's expected values were executed by the plan author. If a test fails and the implementation matches the plan, suspect the fixture, fix it minimally, and report it.

## Review Focus

1. **A blocker that is soft-deleted** stops counting as open. The badge disappears, the warning doesn't fire, and a notification may fire once the remaining blockers are done. Covered by the `openBlockers` unit test (Task 3), which pins a missing blocker.
2. **Two people adding A→B and B→A at the same moment** must not both succeed. `add_dependency` takes a `for no key update` lock on the project row before the cycle check, so the second caller sees the first edge. This is not load-tested; the reviewer checks the lock ordering in the SQL.
3. **Completing one of two blockers** must not notify. Only the last one does, and a blocked task with no assignee notifies nobody. Covered by the Task 2 RLS test.
4. **Dragging a blocked task within its own column** (reordering) must not show the dialog. **Cancelling** the dialog must leave the card in its original column with no request sent. Covered by the `shouldWarnBeforeMove` unit test (Task 5).
5. **The picker** must not offer the task itself or tasks already blocking it. Picking a task that would create a cycle shows the server's "block each other" message inline. Covered by the Task 4 component test.

---

### Task 1: Dependencies schema, write RPCs and read RPC

**Files:**
- Create: `supabase/migrations/202610040001_dependency_enums.sql`
- Create: `supabase/migrations/202610040002_task_dependencies.sql`
- Test: `src/test/rls/dependencies.test.ts`

**Interfaces:**
- Produces the table `public.task_dependencies(project_id, blocker_task_id, blocked_task_id, created_by, created_at)`, with primary key `(blocker_task_id, blocked_task_id)`.
- Produces `add_dependency(p_blocker uuid, p_blocked uuid) returns void`.
- Produces `remove_dependency(p_blocker uuid, p_blocked uuid) returns void`.
- Produces `task_dependencies_for(p_task_id uuid)`, which returns `(direction text /* 'blocked_by' | 'blocking' */, task_id uuid, title varchar, is_done boolean)`.
- Produces the enum values: `activity_action` gains `dependency_added` and `dependency_removed`; `notification_type` gains `blocker_resolved` (used in Task 2).

- [ ] **Step 1: Write the failing RLS test**

Create `src/test/rls/dependencies.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let fixture: IsolationFixture;
let taskX: string;
let taskY: string;
let otherProjectTask: string;

function row<T>(data: T | T[] | null): T {
  return (Array.isArray(data) ? data[0] : data) as T;
}

async function createTask(projectId: string, columnId: string, title: string) {
  const created = await fixture.a.rpc("create_task", {
    p_project_id: projectId,
    p_column_id: columnId,
    p_title: title,
  });
  if (created.error) throw created.error;
  return row<{ id: string }>(created.data).id;
}

beforeAll(async () => {
  fixture = await seedIsolationFixture();
  taskX = await createTask(fixture.projectId, fixture.columnId, "X");
  taskY = await createTask(fixture.projectId, fixture.columnId, "Y");
  const other = await fixture.a.rpc("create_project", {
    p_name: "Other P",
    p_description: null,
    p_timezone: "UTC",
  });
  const otherId = row<{ id: string }>(other.data).id;
  const otherColumn = await fixture.a
    .from("columns")
    .select("id")
    .eq("project_id", otherId)
    .order("position")
    .limit(1)
    .single();
  otherProjectTask = await createTask(otherId, otherColumn.data!.id, "Z");
});
afterAll(async () => {
  await fixture?.cleanup();
});

describe("task dependencies", () => {
  it("records a blocker and lists it from both sides", async () => {
    const added = await fixture.a.rpc("add_dependency", {
      p_blocker: taskX,
      p_blocked: fixture.taskId,
    });
    expect(added.error).toBeNull();
    const blocked = await fixture.a.rpc("task_dependencies_for", { p_task_id: fixture.taskId });
    expect(blocked.data).toEqual([
      { direction: "blocked_by", task_id: taskX, title: "X", is_done: false },
    ]);
    const blocking = await fixture.a.rpc("task_dependencies_for", { p_task_id: taskX });
    expect(blocking.data).toEqual([
      { direction: "blocking", task_id: fixture.taskId, title: "A's task", is_done: false },
    ]);
  });

  it("hides edges from non-members", async () => {
    const read = await fixture.b
      .from("task_dependencies")
      .select("blocker_task_id")
      .eq("project_id", fixture.projectId);
    expect(read.data).toEqual([]);
    const add = await fixture.b.rpc("add_dependency", { p_blocker: taskY, p_blocked: taskX });
    expect(add.error?.code).toBe("P0002");
    const list = await fixture.b.rpc("task_dependencies_for", { p_task_id: fixture.taskId });
    expect(list.error?.code).toBe("P0002");
  });

  it("rejects self, cross-project, duplicate and cyclic links", async () => {
    const self = await fixture.a.rpc("add_dependency", { p_blocker: taskX, p_blocked: taskX });
    expect(self.error?.code).toBe("22023");
    const crossProject = await fixture.a.rpc("add_dependency", {
      p_blocker: otherProjectTask,
      p_blocked: taskX,
    });
    expect(crossProject.error?.code).toBe("22023");
    const duplicate = await fixture.a.rpc("add_dependency", {
      p_blocker: taskX,
      p_blocked: fixture.taskId,
    });
    expect(duplicate.error?.code).toBe("23505");
    // X blocks T (test 1); T blocks Y; so Y blocking X would close a cycle.
    const chain = await fixture.a.rpc("add_dependency", {
      p_blocker: fixture.taskId,
      p_blocked: taskY,
    });
    expect(chain.error).toBeNull();
    const cycle = await fixture.a.rpc("add_dependency", { p_blocker: taskY, p_blocked: taskX });
    expect(cycle.error?.code).toBe("P0005");
  });

  it("refuses viewers and caps blockers at 20", async () => {
    const admin = createAdminClient();
    await admin
      .from("memberships")
      .insert({ project_id: fixture.projectId, user_id: fixture.bId, role: "viewer" });
    const viewer = await fixture.b.rpc("add_dependency", { p_blocker: taskY, p_blocked: taskX });
    expect(viewer.error?.code).toBe("42501");

    const seeded = await admin
      .from("tasks")
      .insert(
        Array.from({ length: 20 }, (_, index) => ({
          project_id: fixture.projectId,
          column_id: fixture.columnId,
          title: `Blocker ${index}`,
          position: 100 + index,
          created_by: fixture.aId,
        })),
      )
      .select("id");
    expect(seeded.error).toBeNull();
    const edges = await admin.from("task_dependencies").insert(
      seeded.data!.map((blocker) => ({
        project_id: fixture.projectId,
        blocker_task_id: blocker.id,
        blocked_task_id: taskX,
        created_by: fixture.aId,
      })),
    );
    expect(edges.error).toBeNull();
    const overCap = await fixture.a.rpc("add_dependency", {
      p_blocker: fixture.taskId,
      p_blocked: taskX,
    });
    expect(overCap.error?.code).toBe("22023");
  });

  it("removes a link and records both activity entries", async () => {
    const removed = await fixture.a.rpc("remove_dependency", {
      p_blocker: taskX,
      p_blocked: fixture.taskId,
    });
    expect(removed.error).toBeNull();
    const list = await fixture.a.rpc("task_dependencies_for", { p_task_id: fixture.taskId });
    expect(list.data).toEqual([
      { direction: "blocking", task_id: taskY, title: "Y", is_done: false },
    ]);
    const activity = await fixture.a
      .from("activity")
      .select("action")
      .eq("task_id", fixture.taskId)
      .in("action", ["dependency_added", "dependency_removed"]);
    expect(activity.data?.map((entry) => entry.action).sort()).toEqual([
      "dependency_added",
      "dependency_removed",
    ]);
    const missing = await fixture.a.rpc("remove_dependency", {
      p_blocker: taskX,
      p_blocked: fixture.taskId,
    });
    expect(missing.error?.code).toBe("P0002");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:rls -- src/test/rls/dependencies.test.ts`
Expected: FAIL. `add_dependency` is not found (`PGRST202`).

- [ ] **Step 3: Write the migrations**

Create `supabase/migrations/202610040001_dependency_enums.sql`:

```sql
-- Kept separate: PostgreSQL forbids using a freshly added enum value in the
-- same transaction that adds it.
alter type public.activity_action add value if not exists 'dependency_added';
alter type public.activity_action add value if not exists 'dependency_removed';
alter type public.notification_type add value if not exists 'blocker_resolved';
```

Create `supabase/migrations/202610040002_task_dependencies.sql`:

```sql
-- "Blocker must finish before blocked starts" edges (spec 3C). Warn-only:
-- move_task is unchanged; the client confirms before starting a blocked task.
create table public.task_dependencies (
  project_id uuid not null references public.projects(id) on delete cascade,
  blocker_task_id uuid not null references public.tasks(id) on delete cascade,
  blocked_task_id uuid not null references public.tasks(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (blocker_task_id, blocked_task_id),
  check (blocker_task_id <> blocked_task_id)
);
create index idx_task_dependencies_blocked on public.task_dependencies(blocked_task_id);
create index idx_task_dependencies_project on public.task_dependencies(project_id);
alter table public.task_dependencies enable row level security;
alter table public.task_dependencies force row level security;
create policy task_dependencies_member_read on public.task_dependencies
  for select using (public.is_project_member(project_id));

create or replace function public.add_dependency(p_blocker uuid, p_blocked uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  blocked_row public.tasks%rowtype;
  blocker_row public.tasks%rowtype;
  creates_cycle boolean;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into blocked_row from public.tasks where tasks.id = p_blocked and tasks.deleted_at is null;
  if not found or not public.is_project_member(blocked_row.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(blocked_row.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_blocker = p_blocked then raise exception 'SELF_DEPENDENCY' using errcode = '22023'; end if;
  select * into blocker_row from public.tasks where tasks.id = p_blocker and tasks.deleted_at is null;
  if not found or blocker_row.project_id <> blocked_row.project_id then
    raise exception 'INVALID_BLOCKER' using errcode = '22023';
  end if;
  -- Serialise dependency writes per project so two opposite edges added at
  -- once cannot both pass the cycle check. NO KEY UPDATE does not block
  -- inserts that reference the project.
  perform 1 from public.projects where projects.id = blocked_row.project_id for no key update;
  if exists (
    select 1 from public.task_dependencies d where d.blocker_task_id = p_blocker and d.blocked_task_id = p_blocked
  ) then raise exception 'DEPENDENCY_EXISTS' using errcode = '23505'; end if;
  if (select count(*) from public.task_dependencies d where d.blocked_task_id = p_blocked) >= 20 then
    raise exception 'DEPENDENCY_LIMIT' using errcode = '22023';
  end if;
  with recursive downstream(task_id) as (
    select d.blocked_task_id from public.task_dependencies d where d.blocker_task_id = p_blocked
    union
    select d.blocked_task_id from public.task_dependencies d join downstream on d.blocker_task_id = downstream.task_id
  )
  select exists (select 1 from downstream where downstream.task_id = p_blocker) into creates_cycle;
  if creates_cycle then raise exception 'DEPENDENCY_CYCLE' using errcode = 'P0005'; end if;
  insert into public.task_dependencies (project_id, blocker_task_id, blocked_task_id, created_by)
  values (blocked_row.project_id, p_blocker, p_blocked, current_user_id);
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, to_value)
  values (blocked_row.project_id, current_user_id, p_blocked, 'task_dependency', p_blocker, 'dependency_added',
    jsonb_build_object('blockerTaskId', p_blocker, 'blockerTitle', blocker_row.title));
end;
$$;

create or replace function public.remove_dependency(p_blocker uuid, p_blocked uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  edge public.task_dependencies%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into edge from public.task_dependencies d
  where d.blocker_task_id = p_blocker and d.blocked_task_id = p_blocked for update;
  if not found or not public.is_project_member(edge.project_id) then raise exception 'DEPENDENCY_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(edge.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.task_dependencies d where d.blocker_task_id = p_blocker and d.blocked_task_id = p_blocked;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value)
  values (edge.project_id, current_user_id, p_blocked, 'task_dependency', p_blocker, 'dependency_removed',
    jsonb_build_object('blockerTaskId', p_blocker));
end;
$$;

create or replace function public.task_dependencies_for(p_task_id uuid)
returns table (direction text, task_id uuid, title varchar, is_done boolean)
language plpgsql stable security invoker set search_path = public as $$
declare target_project uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select t.project_id into target_project from public.tasks t where t.id = p_task_id and t.deleted_at is null;
  if target_project is null or not public.is_project_member(target_project) then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;
  return query
    select 'blocked_by'::text, b.id, b.title, c.is_done_column
    from public.task_dependencies d
    join public.tasks b on b.id = d.blocker_task_id and b.deleted_at is null
    join public.columns c on c.id = b.column_id
    where d.blocked_task_id = p_task_id
    union all
    select 'blocking'::text, x.id, x.title, c.is_done_column
    from public.task_dependencies d
    join public.tasks x on x.id = d.blocked_task_id and x.deleted_at is null
    join public.columns c on c.id = x.column_id
    where d.blocker_task_id = p_task_id
    order by 1, 3;
end;
$$;

revoke all on function public.add_dependency(uuid, uuid) from public, anon;
revoke all on function public.remove_dependency(uuid, uuid) from public, anon;
revoke all on function public.task_dependencies_for(uuid) from public, anon;
grant execute on function public.add_dependency(uuid, uuid) to authenticated;
grant execute on function public.remove_dependency(uuid, uuid) to authenticated;
grant execute on function public.task_dependencies_for(uuid) to authenticated;
```

- [ ] **Step 4: Apply and run**

Run: `npx supabase db push` (confirm the two migrations), then `npm run test:rls -- src/test/rls/dependencies.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202610040001_dependency_enums.sql supabase/migrations/202610040002_task_dependencies.sql src/test/rls/dependencies.test.ts
git commit -m "feat(dependencies): add task_dependencies with add, remove and list RPCs"
```

---

### Task 2: `blocker_resolved` notification

**Files:**
- Create: `supabase/migrations/202610040003_blocker_resolved_notifications.sql`
- Test: `src/test/rls/dependency-notifications.test.ts`
- Modify: `src/components/notifications/notifications-center.tsx` (`describe`)
- Modify: `src/lib/notifications/flush.ts` (`describe`)

**Interfaces:**
- Consumes: the enum value `blocker_resolved` (Task 1) and `enqueue_notifications(type, project, task, actor, recipients[], payload)`.
- Produces: `notification_category_for('blocker_resolved') = 'status_change'`. The trigger `tasks_notify_blockers_resolved` sends the payload `{ taskTitle, blockerTitle }`.

- [ ] **Step 1: Write the failing RLS test**

Create `src/test/rls/dependency-notifications.test.ts`:

```ts
import { afterAll, beforeAll, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let fixture: IsolationFixture;
let doneColumnId: string;
let blockerA: string;
let blockerC: string;

function row<T>(data: T | T[] | null): T {
  return (Array.isArray(data) ? data[0] : data) as T;
}

async function createTask(title: string) {
  const created = await fixture.a.rpc("create_task", {
    p_project_id: fixture.projectId,
    p_column_id: fixture.columnId,
    p_title: title,
  });
  if (created.error) throw created.error;
  return row<{ id: string }>(created.data).id;
}

async function complete(taskId: string) {
  const moved = await fixture.a.rpc("move_task", {
    p_task_id: taskId,
    p_column_id: doneColumnId,
    p_position: 1000,
    p_mutation_id: crypto.randomUUID(),
  });
  expect(moved.error).toBeNull();
}

async function resolvedFor(taskId: string) {
  const result = await fixture.b
    .from("notifications")
    .select("type, payload")
    .eq("task_id", taskId)
    .eq("type", "blocker_resolved");
  expect(result.error).toBeNull();
  return result.data ?? [];
}

beforeAll(async () => {
  fixture = await seedIsolationFixture();
  const admin = createAdminClient();
  await admin
    .from("memberships")
    .insert({ project_id: fixture.projectId, user_id: fixture.bId, role: "member" });
  const done = await admin
    .from("columns")
    .select("id")
    .eq("project_id", fixture.projectId)
    .eq("is_done_column", true)
    .single();
  doneColumnId = done.data!.id;
  blockerA = await createTask("Blocker A");
  blockerC = await createTask("Blocker C");
  await admin.from("tasks").update({ assignee_id: fixture.bId }).eq("id", fixture.taskId);
  for (const blocker of [blockerA, blockerC]) {
    const added = await fixture.a.rpc("add_dependency", {
      p_blocker: blocker,
      p_blocked: fixture.taskId,
    });
    expect(added.error).toBeNull();
  }
});
afterAll(async () => {
  await fixture?.cleanup();
});

it("waits for the last open blocker, then notifies the assignee once", async () => {
  await complete(blockerA);
  expect(await resolvedFor(fixture.taskId)).toEqual([]);
  await complete(blockerC);
  expect(await resolvedFor(fixture.taskId)).toEqual([
    {
      type: "blocker_resolved",
      payload: expect.objectContaining({ taskTitle: "A's task", blockerTitle: "Blocker C" }),
    },
  ]);
});

it("does not notify when the blocked task has no assignee", async () => {
  const unassigned = await createTask("Unassigned blocked");
  const blocker = await createTask("Lonely blocker");
  await fixture.a.rpc("add_dependency", { p_blocker: blocker, p_blocked: unassigned });
  await complete(blocker);
  const any = await createAdminClient()
    .from("notifications")
    .select("id")
    .eq("task_id", unassigned)
    .eq("type", "blocker_resolved");
  expect(any.data).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:rls -- src/test/rls/dependency-notifications.test.ts`
Expected: FAIL on the second assertion (`[]` received), because no trigger exists yet.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/202610040003_blocker_resolved_notifications.sql`:

```sql
-- blocker_resolved shares the status_change preference category.
create or replace function public.notification_category_for(p_type public.notification_type)
returns public.notification_category language sql immutable set search_path = public as $$
  select case p_type
    when 'task_assigned' then 'assignment'::public.notification_category
    when 'task_unassigned' then 'assignment'::public.notification_category
    when 'mentioned' then 'mention'::public.notification_category
    when 'status_changed' then 'status_change'::public.notification_category
    when 'blocker_resolved' then 'status_change'::public.notification_category
    when 'due_soon' then 'due_soon'::public.notification_category
    when 'digest_ready' then 'digest'::public.notification_category end;
$$;

-- When a task enters the done column, notify the assignee of every task it
-- was blocking that now has no open blocker left. Same transaction as the
-- move (AFTER trigger), so the NOT EXISTS below sees the new column.
create function public.notify_blockers_resolved() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  entered_done boolean;
  blocked record;
begin
  if auth.uid() is null or new.deleted_at is not null or old.column_id is not distinct from new.column_id then
    return new;
  end if;
  select c.is_done_column into entered_done from public.columns c where c.id = new.column_id;
  if not coalesce(entered_done, false) then return new; end if;
  for blocked in
    select t.id, t.project_id, t.title, t.assignee_id
    from public.task_dependencies d
    join public.tasks t on t.id = d.blocked_task_id
    where d.blocker_task_id = new.id
      and t.deleted_at is null
      and t.assignee_id is not null
      and not exists (
        select 1 from public.task_dependencies d2
        join public.tasks b on b.id = d2.blocker_task_id and b.deleted_at is null
        join public.columns bc on bc.id = b.column_id
        where d2.blocked_task_id = t.id and not bc.is_done_column
      )
  loop
    perform public.enqueue_notifications('blocker_resolved', blocked.project_id, blocked.id, auth.uid(),
      array[blocked.assignee_id], jsonb_build_object('taskTitle', blocked.title, 'blockerTitle', new.title));
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_blockers_resolved() from public, anon, authenticated;
create trigger tasks_notify_blockers_resolved after update of column_id on public.tasks
  for each row execute function public.notify_blockers_resolved();
```

- [ ] **Step 4: Render the new type**

In `src/components/notifications/notifications-center.tsx`, inside `describe`, add before `default:`:

```tsx
    case "blocker_resolved":
      return `"${title}" is no longer blocked`;
```

In `src/lib/notifications/flush.ts`, add the same case to its `describe`, before `default:`.

- [ ] **Step 5: Apply and run**

Run: `npx supabase db push`, then `npm run test:rls -- src/test/rls/dependency-notifications.test.ts src/test/rls/notifications.test.ts`, then `npm test`, then `npm run typecheck`
Expected: 2 new tests pass and the existing notifications RLS tests still pass. Unit tests and typecheck are clean.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202610040003_blocker_resolved_notifications.sql src/test/rls/dependency-notifications.test.ts src/components/notifications/notifications-center.tsx src/lib/notifications/flush.ts
git commit -m "feat(dependencies): notify assignees when their last blocker is done"
```

---

### Task 3: Blocked badge (board, list, calendar)

**Files:**
- Create: `src/lib/dependencies/open-blockers.ts`
- Create: `src/lib/dependencies/open-blockers.test.ts`
- Create: `src/components/tasks/blocked-badge.tsx`
- Create: `supabase/migrations/202610040004_calendar_open_blockers.sql`
- Modify: `src/app/(app)/p/[projectId]/board/page.tsx`, `src/app/(app)/p/[projectId]/list/page.tsx` (load edges, and `is_in_progress_column` on the board)
- Modify: `src/components/board/project-board.tsx` (`BoardColumn`, `initialDependencies` prop, `edges` state, `TaskCard` badge)
- Modify: `src/lib/realtime/board-sync.ts` (`ColumnRow`, `toBoardColumn`)
- Modify: `src/components/list/project-task-list.tsx`, `src/components/list/grouped-task-list.tsx`, `src/components/list/task-table.tsx` (pass `blockedTaskIds`, render badge)
- Modify: `src/components/calendar/use-calendar-tasks.ts`, `src/components/calendar/calendar-grid.tsx` and both calendar test fixtures (`open_blocker_count`)
- Test: add a case to `src/test/rls/dependencies.test.ts`

**Interfaces:**
- Produces, in `src/lib/dependencies/open-blockers.ts`:
  - `type DependencyEdge = { blocker_task_id: string; blocked_task_id: string }`
  - `openBlockers<T extends { id: string; column_id: string }>(taskId, edges, tasks: T[], columns: { id: string; is_done_column?: boolean }[]): T[]`
  - `blockedTaskIds(edges, tasks, columns): Set<string>`
- Produces `BlockedBadge()`.
- `ProjectBoard` and `ProjectTaskList` gain a prop `initialDependencies: DependencyEdge[]`.
- `BoardColumn` gains `is_in_progress_column?: boolean`.
- `CalendarTask` gains `open_blocker_count: number`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/dependencies/open-blockers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { blockedTaskIds, openBlockers } from "./open-blockers";

const columns = [
  { id: "todo", is_done_column: false },
  { id: "done", is_done_column: true },
];
const tasks = [
  { id: "a", column_id: "todo", title: "A" },
  { id: "b", column_id: "done", title: "B" },
  { id: "t", column_id: "todo", title: "T" },
];
const edges = [
  { blocker_task_id: "a", blocked_task_id: "t" },
  { blocker_task_id: "b", blocked_task_id: "t" },
  { blocker_task_id: "gone", blocked_task_id: "t" },
];

describe("openBlockers", () => {
  it("returns blockers that exist and are not in a done column", () => {
    expect(openBlockers("t", edges, tasks, columns).map((task) => task.id)).toEqual(["a"]);
  });

  it("treats a deleted (missing) blocker as resolved", () => {
    expect(openBlockers("t", [edges[2]!], tasks, columns)).toEqual([]);
  });

  it("collects every task with an open blocker", () => {
    expect([...blockedTaskIds(edges, tasks, columns)]).toEqual(["t"]);
    expect([...blockedTaskIds(edges.slice(1), tasks, columns)]).toEqual([]);
  });
});
```

Append to `src/test/rls/dependencies.test.ts` (inside the `describe`, as the last test):

```ts
  it("counts open blockers in the calendar", async () => {
    const admin = createAdminClient();
    await admin.from("tasks").update({ due_date: "2026-09-24" }).eq("id", taskY);
    const calendar = await fixture.a.rpc("calendar_tasks", {
      p_project_id: fixture.projectId,
      p_from: "2026-08-31",
      p_to: "2026-10-11",
      p_include_undated: false,
    });
    expect(calendar.error).toBeNull();
    expect(calendar.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: taskY, open_blocker_count: 1 })]),
    );
  });
```

(At that point Y is blocked only by T, which is open: the 20 seeded blockers target X, and X→T was removed.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/dependencies/open-blockers.test.ts`, then `npm run test:rls -- src/test/rls/dependencies.test.ts`
Expected: the unit test fails with "Failed to resolve import". The new RLS case fails because `open_blocker_count` is missing.

- [ ] **Step 3: Write the helper, badge and migration**

Create `src/lib/dependencies/open-blockers.ts`:

```ts
export type DependencyEdge = { blocker_task_id: string; blocked_task_id: string };

type ColumnLike = { id: string; is_done_column?: boolean };

export function openBlockers<T extends { id: string; column_id: string }>(
  taskId: string,
  edges: DependencyEdge[],
  tasks: T[],
  columns: ColumnLike[],
): T[] {
  const doneColumns = new Set(columns.filter((column) => column.is_done_column).map((c) => c.id));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return edges.flatMap((edge) => {
    if (edge.blocked_task_id !== taskId) return [];
    const blocker = byId.get(edge.blocker_task_id);
    return blocker && !doneColumns.has(blocker.column_id) ? [blocker] : [];
  });
}

export function blockedTaskIds<T extends { id: string; column_id: string }>(
  edges: DependencyEdge[],
  tasks: T[],
  columns: ColumnLike[],
): Set<string> {
  const ids = new Set(edges.map((edge) => edge.blocked_task_id));
  return new Set([...ids].filter((id) => openBlockers(id, edges, tasks, columns).length > 0));
}
```

Create `src/components/tasks/blocked-badge.tsx`:

```tsx
import { Lock } from "lucide-react";

export function BlockedBadge() {
  return (
    <span className="bg-status-amber-bg text-status-amber-fg border-status-amber-border inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium">
      <Lock className="size-3" aria-hidden="true" />
      Blocked
    </span>
  );
}
```

If the `status-amber-*` utilities are not defined in `src/app/globals.css`, use the tokens the board already uses for amber (`text-status-amber-fg` exists; check `globals.css` `@theme inline` for the matching `bg` and `border` names). Report which ones you used.

Create `supabase/migrations/202610040004_calendar_open_blockers.sql`. It is the 3A function plus `open_blocker_count`. The return type changes, so drop and recreate:

```sql
drop function public.calendar_tasks(uuid, date, date, boolean);

create function public.calendar_tasks(
  p_project_id uuid,
  p_from date,
  p_to date,
  p_include_undated boolean default false
)
returns table (
  id uuid, project_id uuid, project_name varchar, title varchar, description text,
  due_date date, priority public.task_priority, column_id uuid, column_name varchar,
  is_done boolean, assignee_id uuid, updated_at timestamptz, can_edit boolean,
  subtask_done integer, subtask_total integer, open_blocker_count integer
)
language plpgsql stable security invoker set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 41 then
    raise exception 'INVALID_RANGE' using errcode = '22023';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.deleted_at is null and public.is_project_member(p.id)
  ) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  return query
    select t.id, t.project_id, p.name, t.title, t.description, t.due_date, t.priority,
      t.column_id, c.name, c.is_done_column, t.assignee_id, t.updated_at,
      public.can_write_project(t.project_id),
      coalesce(s.done, 0)::integer, coalesce(s.total, 0)::integer, coalesce(ob.open_count, 0)::integer
    from public.tasks t
    join public.projects p on p.id = t.project_id and p.deleted_at is null
    join public.columns c on c.id = t.column_id and c.project_id = t.project_id and c.deleted_at is null
    left join lateral (
      select count(*) filter (where st.is_completed) as done, count(*) as total
      from public.subtasks st where st.task_id = t.id
    ) s on true
    left join lateral (
      select count(*) as open_count
      from public.task_dependencies d
      join public.tasks b on b.id = d.blocker_task_id and b.deleted_at is null
      join public.columns bc on bc.id = b.column_id
      where d.blocked_task_id = t.id and not bc.is_done_column
    ) ob on true
    where t.deleted_at is null
      and public.is_project_member(t.project_id)
      and (case when p_project_id is null then t.assignee_id = auth.uid() else t.project_id = p_project_id end)
      and t.due_date between p_from and p_to
    order by t.due_date, t.position, t.id;

  if p_include_undated then
    return query
      select t.id, t.project_id, p.name, t.title, t.description, t.due_date, t.priority,
        t.column_id, c.name, c.is_done_column, t.assignee_id, t.updated_at,
        public.can_write_project(t.project_id),
        coalesce(s.done, 0)::integer, coalesce(s.total, 0)::integer, coalesce(ob.open_count, 0)::integer
      from public.tasks t
      join public.projects p on p.id = t.project_id and p.deleted_at is null
      join public.columns c on c.id = t.column_id and c.project_id = t.project_id and c.deleted_at is null
      left join lateral (
        select count(*) filter (where st.is_completed) as done, count(*) as total
        from public.subtasks st where st.task_id = t.id
      ) s on true
      left join lateral (
        select count(*) as open_count
        from public.task_dependencies d
        join public.tasks b on b.id = d.blocker_task_id and b.deleted_at is null
        join public.columns bc on bc.id = b.column_id
        where d.blocked_task_id = t.id and not bc.is_done_column
      ) ob on true
      where t.deleted_at is null
        and public.is_project_member(t.project_id)
        and (case when p_project_id is null then t.assignee_id = auth.uid() else t.project_id = p_project_id end)
        and t.due_date is null
      order by t.updated_at desc, t.id
      limit 100;
  end if;
end;
$$;
revoke all on function public.calendar_tasks(uuid, date, date, boolean) from public, anon;
grant execute on function public.calendar_tasks(uuid, date, date, boolean) to authenticated;
```

- [ ] **Step 4: Wire the badge through the UI**

Calendar:
- In `use-calendar-tasks.ts`, add `open_blocker_count: number;` to `CalendarTask`.
- In `use-calendar-tasks.test.tsx` and `calendar-grid.test.tsx`, add `open_blocker_count: 0,` to the base fixture objects (`row` and `base`).
- In `calendar-grid.tsx` `CalendarChip`, import `BlockedBadge` and render `{task.open_blocker_count > 0 && <BlockedBadge />}` as the last child of the chip `div`.

Realtime columns (`src/lib/realtime/board-sync.ts`): add `is_in_progress_column?: boolean;` to `ColumnRow`, and `is_in_progress_column: row.is_in_progress_column,` to `toBoardColumn`.

Board page: change the columns select to `"id, name, position, wip_limit, is_done_column, is_in_progress_column"`. Add this to the `Promise.all` list, destructuring it as `{ data: dependencyData }`:

```tsx
    supabase
      .from("task_dependencies")
      .select("blocker_task_id, blocked_task_id")
      .eq("project_id", projectId),
```

Then pass `initialDependencies={dependencyData ?? []}` to `ProjectBoard`. Make the same two additions in the list page: add the query to its `Promise.all` as `dependenciesResult`, and pass `initialDependencies={dependenciesResult.data ?? []}` to `ProjectTaskList`.

`project-board.tsx`:
- Add `is_in_progress_column?: boolean;` to `BoardColumn`.
- Add the prop `initialDependencies: DependencyEdge[]`.
- Add `const [edges, setEdges] = useState(initialDependencies);` next to the other state.
- Add `const blocked = blockedTaskIds(edges, tasks, columns);` after `visibleTasks`.
- Pass `blocked={blocked.has(task.id)}` to each `TaskCard`, and `blocked={false}` to the `DragOverlay` card.
- `TaskCard` takes the prop `blocked: boolean` and renders `{blocked && <BlockedBadge />}` as the first child of the `mt-3 flex … justify-between` row's left side. Wrap the priority span, `SubtaskProgress`, `LinkCount` and the badge in `<span className="flex flex-wrap items-center gap-2">…</span>`, so the due date stays right-aligned.
- `setEdges` is used by Tasks 4 and 5. Until then, prefix it with `void setEdges;` only if lint flags it as unused, and remove that in Task 4.

List:
- `ProjectTaskList` takes `initialDependencies: DependencyEdge[]`, holds `const [edges, setEdges] = useState(initialDependencies);`, and computes `const blocked = blockedTaskIds(edges, tasks, columns);`. It passes `blockedTaskIds={blocked}` to `GroupedTaskList`.
- `GroupedTaskList` forwards the prop `blockedTaskIds: ReadonlySet<string>` to `TaskTable`.
- In `TaskTable`'s title-cell chip row, render `{blockedTaskIds.has(task.id) && <BlockedBadge />}` first.
- Any other `TaskTable` or `GroupedTaskList` caller or test must pass `blockedTaskIds={new Set()}`. Find them with `grep -rn "<TaskTable\|<GroupedTaskList" src`.

- [ ] **Step 5: Apply and run**

Run: `npx supabase db push`, then `npm run test:rls -- src/test/rls/dependencies.test.ts src/test/rls/calendar.test.ts`, then `npm test`, then `npm run typecheck`, then `npm run lint`
Expected: all pass. The calendar RLS tests from 3A still pass against the recreated function.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dependencies src/components/tasks/blocked-badge.tsx supabase/migrations/202610040004_calendar_open_blockers.sql src/test/rls/dependencies.test.ts src/lib/realtime/board-sync.ts "src/app/(app)/p/[projectId]/board/page.tsx" "src/app/(app)/p/[projectId]/list/page.tsx" src/components/board/project-board.tsx src/components/list src/components/calendar
git commit -m "feat(dependencies): show a Blocked badge on cards, rows and calendar chips"
```

---

### Task 4: Dependency routes and the drawer section

**Files:**
- Create: `src/lib/dependencies/errors.ts`
- Create: `src/lib/dependencies/errors.test.ts`
- Create: `src/app/api/v1/tasks/[taskId]/dependencies/route.ts`
- Create: `src/app/api/v1/tasks/[taskId]/dependencies/[blockerTaskId]/route.ts`
- Create: `src/components/board/task-dependencies.tsx`
- Create: `src/components/board/task-dependencies.test.tsx`
- Modify: `src/components/board/task-detail-drawer.tsx`, `src/components/board/task-detail-drawer.test.tsx`, `src/components/board/project-board.tsx`, `src/components/list/project-task-list.tsx`

**Interfaces:**
- Consumes: the Task 1 RPCs, and `DependencyEdge` (Task 3).
- Produces the routes:
  - `GET /api/v1/tasks/[taskId]/dependencies` → `{ data: { direction, task_id, title, is_done }[] }`.
  - `POST /api/v1/tasks/[taskId]/dependencies` with `{ blockerTaskId }` → 201 `{ data: DependencyEdge }`.
  - `DELETE /api/v1/tasks/[taskId]/dependencies/[blockerTaskId]` → 204.
- Produces `TaskDependencies({ taskId, readOnly, candidates, onChange? })`.
- `TaskDetailDrawer` gains the optional props `dependencyCandidates?: { id: string; title: string }[]` and `onDependencyChange?: (change: { type: "added" | "removed"; edge: DependencyEdge }) => void`. The section renders only when `dependencyCandidates` is given.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/dependencies/errors.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { addDependencyErrorResponse } from "./errors";

async function body(response: Response) {
  return (await response.json()) as { error: { code: string; message: string } };
}

describe("addDependencyErrorResponse", () => {
  it("explains cycles", async () => {
    const response = addDependencyErrorResponse({ code: "P0005" }, "r1");
    expect(response.status).toBe(422);
    expect((await body(response)).error.message).toBe(
      "That would make these tasks block each other.",
    );
  });

  it("explains duplicates", async () => {
    const response = addDependencyErrorResponse({ code: "23505" }, "r1");
    expect(response.status).toBe(409);
    expect((await body(response)).error.message).toBe("That task already blocks this one.");
  });

  it("explains invalid blockers and the cap", async () => {
    const response = addDependencyErrorResponse({ code: "22023" }, "r1");
    expect(response.status).toBe(422);
    expect((await body(response)).error.message).toMatch(/at most 20 blockers/);
  });

  it("hides forbidden as not found", async () => {
    expect(addDependencyErrorResponse({ code: "42501" }, "r1").status).toBe(404);
  });
});
```

Create `src/components/board/task-dependencies.test.tsx`:

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TaskDependencies } from "./task-dependencies";

afterEach(() => vi.unstubAllGlobals());

const lists = {
  data: [
    { direction: "blocked_by", task_id: "a", title: "Design API", is_done: false },
    { direction: "blocked_by", task_id: "b", title: "Write spec", is_done: true },
    { direction: "blocking", task_id: "c", title: "Ship release", is_done: false },
  ],
};
const candidates = [
  { id: "t", title: "This task" },
  { id: "a", title: "Design API" },
  { id: "d", title: "Deploy staging" },
  { id: "e", title: "Deploy prod" },
];
const props = { taskId: "t", readOnly: false, candidates };

it("lists blockers and blocked tasks, marking done blockers", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => lists }));
  render(<TaskDependencies {...props} />);
  const blockedBy = await screen.findByRole("list", { name: "Blocked by" });
  expect(within(blockedBy).getByText("Design API")).toBeInTheDocument();
  expect(within(blockedBy).getByText("Done")).toBeInTheDocument();
  expect(
    within(screen.getByRole("list", { name: "Blocking" })).getByText("Ship release"),
  ).toBeInTheDocument();
});

it("offers only other tasks that do not already block this one", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => lists }));
  render(<TaskDependencies {...props} />);
  await userEvent.type(await screen.findByLabelText("Find a blocking task"), "de");
  const options = screen.getAllByRole("button", { name: /^Add .* as a blocker$/ });
  expect(options.map((option) => option.textContent)).toEqual(["Deploy staging", "Deploy prod"]);
});

it("adds a blocker and reports the change", async () => {
  const onChange = vi.fn();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => lists })
    .mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ data: { blocker_task_id: "d", blocked_task_id: "t" } }),
    });
  vi.stubGlobal("fetch", fetchMock);
  render(<TaskDependencies {...props} onChange={onChange} />);
  await userEvent.type(await screen.findByLabelText("Find a blocking task"), "staging");
  await userEvent.click(screen.getByRole("button", { name: "Add Deploy staging as a blocker" }));
  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith({
      type: "added",
      edge: { blocker_task_id: "d", blocked_task_id: "t" },
    }),
  );
  expect(fetchMock.mock.calls[1]![0]).toBe("/api/v1/tasks/t/dependencies");
  expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ blockerTaskId: "d" });
  expect(
    within(screen.getByRole("list", { name: "Blocked by" })).getByText("Deploy staging"),
  ).toBeInTheDocument();
});

it("shows the server's message when a link would create a cycle", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => lists })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ error: { message: "That would make these tasks block each other." } }),
      }),
  );
  render(<TaskDependencies {...props} />);
  await userEvent.type(await screen.findByLabelText("Find a blocking task"), "prod");
  await userEvent.click(screen.getByRole("button", { name: "Add Deploy prod as a blocker" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "That would make these tasks block each other.",
  );
});

it("removes a blocking link through the other task's route", async () => {
  const onChange = vi.fn();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => lists })
    .mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  render(<TaskDependencies {...props} onChange={onChange} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Stop blocking Ship release" }),
  );
  expect(fetchMock.mock.calls[1]![0]).toBe("/api/v1/tasks/c/dependencies/t");
  expect(fetchMock.mock.calls[1]![1].method).toBe("DELETE");
  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith({
      type: "removed",
      edge: { blocker_task_id: "t", blocked_task_id: "c" },
    }),
  );
});

it("is read-only for viewers", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => lists }));
  render(<TaskDependencies {...props} readOnly />);
  await screen.findByRole("list", { name: "Blocked by" });
  expect(screen.queryByLabelText("Find a blocking task")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Remove|^Stop blocking/ })).toBeNull();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/dependencies/errors.test.ts src/components/board/task-dependencies.test.tsx`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Write the error mapper and routes**

Create `src/lib/dependencies/errors.ts`:

```ts
import { mapRpcError } from "@/lib/api/handler";
import { apiError } from "@/lib/api/response";

export function addDependencyErrorResponse(
  error: { code?: string; message?: string },
  requestId: string,
): Response {
  if (error.code === "P0005")
    return apiError(422, "VALIDATION_ERROR", "That would make these tasks block each other.");
  if (error.code === "23505") return apiError(409, "CONFLICT", "That task already blocks this one.");
  return mapRpcError(error, {
    message:
      error.code === "22023"
        ? "Choose another task from this project. A task can have at most 20 blockers."
        : "Dependency could not be added.",
    requestId,
    projectScoped: true,
  });
}
```

Create `src/app/api/v1/tasks/[taskId]/dependencies/route.ts`:

```ts
import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { addDependencyErrorResponse } from "@/lib/dependencies/errors";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.reads,
    params: z.object({ taskId: z.string().uuid() }),
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to view dependencies.",
  },
  async ({ supabase, params, requestId }) => {
    const { data, error } = await supabase.rpc("task_dependencies_for", {
      p_task_id: params.taskId,
    });
    if (error)
      return mapRpcError(error, {
        message: "Dependencies could not be loaded.",
        requestId,
        projectScoped: true,
      });
    return json({ data: data ?? [] });
  },
);

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid() }),
    body: z.object({ blockerTaskId: z.string().uuid() }),
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to add dependencies.",
    validationMessage: "Choose a task from this project.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { error } = await supabase.rpc("add_dependency", {
      p_blocker: body.blockerTaskId,
      p_blocked: params.taskId,
    });
    if (error) return addDependencyErrorResponse(error, requestId);
    return json(
      { data: { blocker_task_id: body.blockerTaskId, blocked_task_id: params.taskId } },
      { status: 201 },
    );
  },
);
```

Create `src/app/api/v1/tasks/[taskId]/dependencies/[blockerTaskId]/route.ts`:

```ts
import { z } from "zod";
import { mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid(), blockerTaskId: z.string().uuid() }),
    notFoundMessage: "Dependency not found.",
    unauthenticatedMessage: "Sign in to remove dependencies.",
  },
  async ({ supabase, params, requestId }) => {
    const { error } = await supabase.rpc("remove_dependency", {
      p_blocker: params.blockerTaskId,
      p_blocked: params.taskId,
    });
    if (error)
      return mapRpcError(error, {
        message: "Dependency could not be removed.",
        requestId,
        projectScoped: true,
      });
    return new Response(null, { status: 204 });
  },
);
```

- [ ] **Step 4: Write the drawer section**

Create `src/components/board/task-dependencies.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DependencyEdge } from "@/lib/dependencies/open-blockers";
import { cn } from "@/lib/utils";

type Related = {
  direction: "blocked_by" | "blocking";
  task_id: string;
  title: string;
  is_done: boolean;
};
export type DependencyChange = { type: "added" | "removed"; edge: DependencyEdge };

const MAX_OPTIONS = 6;

export function TaskDependencies({
  taskId,
  readOnly,
  candidates,
  onChange,
}: {
  taskId: string;
  readOnly: boolean;
  candidates: { id: string; title: string }[];
  onChange?: (change: DependencyChange) => void;
}) {
  const [related, setRelated] = useState<Related[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/tasks/${taskId}/dependencies`)
      .then(async (response) => {
        const payload = (await response.json()) as { data?: unknown };
        if (!response.ok || !Array.isArray(payload.data)) throw new Error("Load rejected");
        if (active) setRelated(payload.data as Related[]);
      })
      .catch(() => active && setError("Dependencies could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [taskId]);

  const blockedBy = related.filter((item) => item.direction === "blocked_by");
  const blocking = related.filter((item) => item.direction === "blocking");
  const excluded = new Set([taskId, ...blockedBy.map((item) => item.task_id)]);
  const needle = query.trim().toLowerCase();
  const options = needle
    ? candidates
        .filter((task) => !excluded.has(task.id) && task.title.toLowerCase().includes(needle))
        .slice(0, MAX_OPTIONS)
    : [];

  async function addBlocker(blocker: { id: string; title: string }) {
    setError(null);
    setPendingId(blocker.id);
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockerTaskId: blocker.id }),
      });
      const payload = (await response.json()) as {
        data?: DependencyEdge;
        error?: { message?: string };
      };
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message ?? "Dependency could not be added. Try again.");
      setRelated((current) => [
        ...current,
        { direction: "blocked_by", task_id: blocker.id, title: blocker.title, is_done: false },
      ]);
      setQuery("");
      onChange?.({ type: "added", edge: payload.data });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Dependency could not be added. Try again.",
      );
    } finally {
      setPendingId(null);
    }
  }

  async function removeLink(item: Related) {
    const edge: DependencyEdge =
      item.direction === "blocked_by"
        ? { blocker_task_id: item.task_id, blocked_task_id: taskId }
        : { blocker_task_id: taskId, blocked_task_id: item.task_id };
    setError(null);
    setPendingId(item.task_id);
    try {
      const response = await fetch(
        `/api/v1/tasks/${edge.blocked_task_id}/dependencies/${edge.blocker_task_id}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Delete rejected");
      setRelated((current) =>
        current.filter(
          (candidate) =>
            !(candidate.task_id === item.task_id && candidate.direction === item.direction),
        ),
      );
      onChange?.({ type: "removed", edge });
    } catch {
      setError("Dependency could not be removed. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  function renderList(label: "Blocked by" | "Blocking", items: Related[], empty: string) {
    return (
      <div>
        <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </h4>
        <ul aria-label={label} className="mt-1 space-y-1">
          {items.map((item) => (
            <li
              key={`${item.direction}:${item.task_id}`}
              className="hover:bg-muted/60 flex items-center gap-2 rounded-md px-1 py-1 text-sm"
            >
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  item.is_done && "text-muted-foreground line-through",
                )}
              >
                {item.title}
              </span>
              {item.is_done && <span className="text-muted-foreground text-xs">Done</span>}
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    item.direction === "blocked_by"
                      ? `Remove blocker ${item.title}`
                      : `Stop blocking ${item.title}`
                  }
                  disabled={pendingId === item.task_id}
                  onClick={() => void removeLink(item)}
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
        {items.length === 0 && <p className="text-muted-foreground text-sm">{empty}</p>}
      </div>
    );
  }

  return (
    <section className="space-y-3 border-t pt-5" aria-labelledby="dependencies-title">
      <h3 id="dependencies-title" className="font-medium">
        Dependencies
      </h3>
      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" /> Loading dependencies
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {renderList("Blocked by", blockedBy, "Nothing has to finish first.")}
          {renderList("Blocking", blocking, "No tasks are waiting on this one.")}
        </div>
      )}
      {!readOnly && !loading && (
        <div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a task that must finish first"
            aria-label="Find a blocking task"
            className="bg-background placeholder:text-muted-foreground focus-visible:ring-ring/40 h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
          />
          {options.length > 0 && (
            <ul className="mt-1 rounded-md border">
              {options.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    aria-label={`Add ${task.title} as a blocker`}
                    disabled={pendingId === task.id}
                    onClick={() => void addBlocker(task)}
                    className="hover:bg-muted focus-visible:bg-muted w-full truncate px-3 py-2 text-left text-sm outline-none"
                  >
                    {task.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Wire it into the drawer, board and list**

`task-detail-drawer.tsx`:
- `import { TaskDependencies, type DependencyChange } from "./task-dependencies";`
- Add the props `dependencyCandidates?: { id: string; title: string }[];` and `onDependencyChange?: (change: DependencyChange) => void;`, and destructure both.
- After the `<TaskLinks … />` element, add:

```tsx
          {dependencyCandidates && (
            <TaskDependencies
              taskId={task.id}
              readOnly={readOnly}
              candidates={dependencyCandidates}
              onChange={onDependencyChange}
            />
          )}
```

`task-detail-drawer.test.tsx`: add `vi.mock("./task-dependencies", () => ({ TaskDependencies: () => null }));` next to the other mocks.

`project-board.tsx` and `project-task-list.tsx` (both drawers): pass

```tsx
          dependencyCandidates={tasks.map((candidate) => ({ id: candidate.id, title: candidate.title }))}
          onDependencyChange={(change) =>
            setEdges((current) =>
              change.type === "added"
                ? [...current, change.edge]
                : current.filter(
                    (edge) =>
                      !(
                        edge.blocker_task_id === change.edge.blocker_task_id &&
                        edge.blocked_task_id === change.edge.blocked_task_id
                      ),
                  ),
            )
          }
```

In `project-task-list.tsx`, use the file's own variable naming if `tasks` is shadowed. Remove any temporary `void setEdges;` from Task 3.

- [ ] **Step 6: Run the tests and checks**

Run: `npm test`, then `npm run typecheck`, then `npm run lint`
Expected: all pass, including the 4 error-mapper tests and the 6 component tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/dependencies/errors.ts src/lib/dependencies/errors.test.ts "src/app/api/v1/tasks/[taskId]/dependencies" src/components/board/task-dependencies.tsx src/components/board/task-dependencies.test.tsx src/components/board/task-detail-drawer.tsx src/components/board/task-detail-drawer.test.tsx src/components/board/project-board.tsx src/components/list/project-task-list.tsx
git commit -m "feat(dependencies): add dependency routes and drawer section"
```

---

### Task 5: Confirm before starting a blocked task

**Files:**
- Create: `src/components/board/blocked-move-dialog.tsx`
- Create: `src/components/board/blocked-move-dialog.test.tsx`
- Modify: `src/lib/dependencies/open-blockers.ts`, `src/lib/dependencies/open-blockers.test.ts` (add `shouldWarnBeforeMove`)
- Modify: `src/components/board/project-board.tsx` (`moveTask`)

**Interfaces:**
- Produces `shouldWarnBeforeMove({ fromColumnId, toColumn, openBlockerCount }): boolean`.
- Produces `BlockedMoveDialog({ taskTitle, columnName, blockers, onConfirm, onCancel })`.
- `moveTask(task, columnId, position?, mutationId?, confirmed = false)`. The board card's `Move to` select and drag-and-drop both go through it.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/dependencies/open-blockers.test.ts`:

```ts
import { shouldWarnBeforeMove } from "./open-blockers";

describe("shouldWarnBeforeMove", () => {
  const inProgress = { id: "doing", is_in_progress_column: true, is_done_column: false };
  const done = { id: "done", is_in_progress_column: false, is_done_column: true };
  const backlog = { id: "backlog", is_in_progress_column: false, is_done_column: false };

  it("warns when starting or finishing a task with open blockers", () => {
    expect(shouldWarnBeforeMove({ fromColumnId: "todo", toColumn: inProgress, openBlockerCount: 1 })).toBe(true);
    expect(shouldWarnBeforeMove({ fromColumnId: "todo", toColumn: done, openBlockerCount: 2 })).toBe(true);
  });

  it("stays quiet for reorders, other columns and unblocked tasks", () => {
    expect(shouldWarnBeforeMove({ fromColumnId: "doing", toColumn: inProgress, openBlockerCount: 1 })).toBe(false);
    expect(shouldWarnBeforeMove({ fromColumnId: "todo", toColumn: backlog, openBlockerCount: 1 })).toBe(false);
    expect(shouldWarnBeforeMove({ fromColumnId: "todo", toColumn: done, openBlockerCount: 0 })).toBe(false);
    expect(shouldWarnBeforeMove({ fromColumnId: "todo", toColumn: undefined, openBlockerCount: 1 })).toBe(false);
  });
});
```

(Move the new import into the file's existing import line from `./open-blockers`.)

Create `src/components/board/blocked-move-dialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { BlockedMoveDialog } from "./blocked-move-dialog";

const blockers = [
  { id: "a", title: "Design API" },
  { id: "b", title: "Write spec" },
];

it("lists the open blockers and confirms", async () => {
  const onConfirm = vi.fn();
  render(
    <BlockedMoveDialog
      taskTitle="Build endpoint"
      columnName="In Progress"
      blockers={blockers}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByRole("dialog", { name: "“Build endpoint” is still blocked" })).toBeInTheDocument();
  expect(screen.getByText("Design API")).toBeInTheDocument();
  expect(screen.getByText("Write spec")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Move anyway" }));
  expect(onConfirm).toHaveBeenCalledOnce();
});

it("cancels on the button and on Escape", async () => {
  const onCancel = vi.fn();
  render(
    <BlockedMoveDialog
      taskTitle="Build endpoint"
      columnName="Done"
      blockers={blockers}
      onConfirm={vi.fn()}
      onCancel={onCancel}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Keep it here" }));
  await userEvent.keyboard("{Escape}");
  expect(onCancel).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/dependencies/open-blockers.test.ts src/components/board/blocked-move-dialog.test.tsx`
Expected: FAIL. `shouldWarnBeforeMove` is not exported, and `./blocked-move-dialog` does not resolve.

- [ ] **Step 3: Write the helper and dialog**

Append to `src/lib/dependencies/open-blockers.ts`:

```ts
export function shouldWarnBeforeMove({
  fromColumnId,
  toColumn,
  openBlockerCount,
}: {
  fromColumnId: string;
  toColumn: { id: string; is_in_progress_column?: boolean; is_done_column?: boolean } | undefined;
  openBlockerCount: number;
}): boolean {
  if (!toColumn || toColumn.id === fromColumnId || openBlockerCount === 0) return false;
  return Boolean(toColumn.is_in_progress_column || toColumn.is_done_column);
}
```

Create `src/components/board/blocked-move-dialog.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function BlockedMoveDialog({
  taskTitle,
  columnName,
  blockers,
  onConfirm,
  onCancel,
}: {
  taskTitle: string;
  columnName: string;
  blockers: { id: string; title: string }[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>“{taskTitle}” is still blocked</DialogTitle>
          <DialogDescription>
            Moving it to {columnName} starts it before these tasks are done:
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {blockers.map((blocker) => (
            <li key={blocker.id}>{blocker.title}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Keep it here
          </Button>
          <Button onClick={onConfirm}>Move anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

If `DialogContent` renders its own close button that also calls `onOpenChange(false)`, that is fine; it cancels.

- [ ] **Step 4: Gate `moveTask`**

In `project-board.tsx`:
- Import `openBlockers` and `shouldWarnBeforeMove` from `@/lib/dependencies/open-blockers`, and `BlockedMoveDialog` from `./blocked-move-dialog`.
- Add state:

```tsx
  const [pendingMove, setPendingMove] = useState<{
    task: BoardTask;
    columnId: string;
    position?: number;
    mutationId?: string;
    blockers: BoardTask[];
  } | null>(null);
```

- Change `moveTask`'s signature to add a trailing `confirmed = false` parameter. Insert this directly after `if (movingTaskId) return;`:

```tsx
    if (!confirmed) {
      const blockers = openBlockers(task.id, edges, tasks, columns);
      if (
        shouldWarnBeforeMove({
          fromColumnId: task.column_id,
          toColumn: columns.find((column) => column.id === columnId),
          openBlockerCount: blockers.length,
        })
      ) {
        setPendingMove({
          task,
          columnId,
          position: proposedPosition,
          mutationId: proposedMutationId,
          blockers,
        });
        return;
      }
    }
```

- Render next to the drawer:

```tsx
      {pendingMove && (
        <BlockedMoveDialog
          taskTitle={pendingMove.task.title}
          columnName={columns.find((column) => column.id === pendingMove.columnId)?.name ?? "that column"}
          blockers={pendingMove.blockers}
          onCancel={() => setPendingMove(null)}
          onConfirm={() => {
            const move = pendingMove;
            setPendingMove(null);
            void moveTask(move.task, move.columnId, move.position, move.mutationId, true);
          }}
        />
      )}
```

Nothing optimistic has happened when the dialog opens: the early return comes before `setTasks`, so cancelling leaves the card where it was, and no request is sent. The card's `Move to` `<select>` is controlled by `task.column_id`, so it snaps back on its own.

- [ ] **Step 5: Run the tests and checks**

Run: `npm test`, then `npm run typecheck`, then `npm run lint`, then `npm run build`
Expected: all clean.

- [ ] **Step 6: Manual end-to-end check**

Run `npm run dev`, detached from the tool console (observation 0002). In a project, make A block B, with B assigned to a second member:
- Drag B to In Progress. The dialog lists A. Choose **Keep it here**; B stays in To Do. Drag again and choose **Move anyway**; B moves.
- Reorder B within its column. No dialog appears.
- Move A to Done. B's Blocked badge disappears. Signed in as B's assignee, the Notifications Center shows `"B" is no longer blocked`.
- Open the project Calendar. B's chip showed Blocked before A was done.
- Check both light and dark themes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/dependencies/open-blockers.ts src/lib/dependencies/open-blockers.test.ts src/components/board/blocked-move-dialog.tsx src/components/board/blocked-move-dialog.test.tsx src/components/board/project-board.tsx
git commit -m "feat(dependencies): confirm before starting or finishing a blocked task"
```

---

## Plan-level rulings

- **The client computes open-ness; the server stores edges.** The board and list load edges once and derive "open blocker" from live task and column state, so realtime moves update badges without a new realtime channel. The calendar uses the SQL `open_blocker_count`, because it has no column state. The two definitions are the same: not deleted, and not in `is_done_column`. Cost if wrong: edges added by *another* user don't appear on your board until you reload. That's acceptable for warn-only badges.
- **Where the warning lives.** The spec says the warning applies to "board drag and the column field in the drawer". The drawer has no column field; column changes happen through the card's `Move to` select and drag-and-drop, and both call `moveTask`. So gating `moveTask` covers every move path. The List view has no column-move control. Cost if wrong: none.
- **The picker adds only "blocked by" links.** To make X block Y, open Y. The "Blocking" list can still remove links. This keeps one picker and one direction. Cost if wrong: a second picker later.
- **Cycles use SQLSTATE `P0005`,** which the route maps to a 422 with a specific message (`src/lib/dependencies/errors.ts`). Cost if wrong: none.

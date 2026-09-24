# 3A Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a month/week calendar of tasks by due date, for one project (new Calendar tab) and for the current user across projects (My Tasks toggle). Dragging a task to a day reschedules it. Board cards and list rows gain an "x/y" subtask-progress chip.

**Architecture:** A new `security invoker` plpgsql RPC, `calendar_tasks`, returns tasks in a date window, either for one project or for the caller's assigned tasks. It is exposed through two thin routes that share one loader. A client hook fetches the window and reschedules through the existing `PATCH /api/v1/tasks/[taskId]` (full payload plus `expectedUpdatedAt`, exactly as the List view's inline edit does). A hand-built grid uses `@dnd-kit/core` for drag and drop.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (plpgsql, PostgREST), zod 3, @dnd-kit/core 6, Vitest + Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-24-calendar-links-dependencies-design.md` (section "3A Calendar").

## Global Constraints

- Business logic lives in plpgsql RPCs. Route handlers stay thin and use `withApiHandler`, `mapRpcError` and `json` from `src/lib/api/handler.ts`.
- No new npm dependencies.
- New migrations are timestamped after `202610010001_project_timeline.sql`. This plan uses `202610020001`.
- RPCs raise `28000` when unauthenticated, `P0002` when not found or not a member, `22023` for invalid input and `42501` when forbidden. `mapRpcError` already maps these.
- The calendar window is at most 42 days (`p_to - p_from <= 41`). Weeks start on Monday. Month view is a 6×7 grid.
- Undated tasks are returned only when `p_include_undated` is true, capped at 100, newest `updated_at` first. The client requests them on the first load only (`undated=1`).
- Commits carry **no** `Co-Authored-By` or `Claude-Session` trailers and use the configured git identity.
- Applying migrations: the user approved running `npx supabase db push` against the linked project (`bewkxittluulfnxjeojw`, which is also production) for these additive migrations. Push only the migration this task creates, and never `db reset`.
- Test fixture status (observation 0008): the expected values in Task 2 (`grid.test.ts`) were executed by the plan author and match. The RLS, hook and component test expectations were **not** executed by the author. If one fails and the implementation matches this plan, suspect the fixture, fix it minimally, and say so in your report.

## Review Focus

1. **A task dragged from the "No due date" tray onto a day** should leave the tray and appear on that day. On failure it should return to the tray, not vanish. The Task 3 hook test covers this.
2. **A realtime refresh after someone else schedules an undated task** must not show that task twice (in the tray and on a day). The Task 3 hook test covers this.
3. **Viewer-role or read-only tasks on the cross-project My Tasks calendar** cannot be dragged, and no request is sent. The RPC's `can_edit` column is pinned in Task 1's RLS test and Task 3's hook test.
4. **A month whose first day is a Monday or a Sunday** must still produce a full 42-day grid starting on the right Monday. Task 2 covers this (2026-02 starts on a Sunday, 2027-03 on a Monday).
5. **A query window longer than 42 days, or with `to` before `from`,** is rejected with 422, not treated as an empty result. Task 1's RLS test and loader test cover this.

---

### Task 1: `calendar_tasks` RPC, shared loader and routes

**Files:**
- Create: `supabase/migrations/202610020001_calendar_tasks.sql`
- Create: `src/lib/calendar/load.ts`
- Create: `src/lib/calendar/load.test.ts`
- Create: `src/app/api/v1/projects/[projectId]/calendar/route.ts`
- Create: `src/app/api/v1/me/calendar/route.ts`
- Test: `src/test/rls/calendar.test.ts`

**Interfaces:**
- Produces the RPC `calendar_tasks(p_project_id uuid, p_from date, p_to date, p_include_undated boolean)`. It returns rows `{ id, project_id, project_name, title, description, due_date, priority, column_id, column_name, is_done, assignee_id, updated_at, can_edit, subtask_done, subtask_total }`.
- Produces `loadCalendar({ supabase, request, requestId, projectId }): Promise<Response>` in `src/lib/calendar/load.ts`.
- Produces the routes `GET /api/v1/projects/[projectId]/calendar?from&to[&undated=1]` and `GET /api/v1/me/calendar?from&to[&undated=1]`, which return `{ data: CalendarRow[] }`.

- [ ] **Step 1: Write the failing RLS test**

Create `src/test/rls/calendar.test.ts`:

```ts
import { afterAll, beforeAll, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let fixture: IsolationFixture;
beforeAll(async () => {
  fixture = await seedIsolationFixture();
});
afterAll(async () => {
  await fixture?.cleanup();
});

const window = { p_from: "2026-08-31", p_to: "2026-10-11" };

async function setTask(values: Record<string, unknown>) {
  const { error } = await createAdminClient()
    .from("tasks")
    .update(values)
    .eq("id", fixture.taskId);
  expect(error).toBeNull();
}

it("returns dated project tasks with subtask counts and hides them from non-members", async () => {
  await setTask({ due_date: "2026-09-24" });
  const first = await fixture.a.rpc("create_subtask", { p_task_id: fixture.taskId, p_title: "One" });
  expect(first.error).toBeNull();
  const second = await fixture.a.rpc("create_subtask", { p_task_id: fixture.taskId, p_title: "Two" });
  const secondRow = Array.isArray(second.data) ? second.data[0] : second.data;
  await fixture.a.rpc("update_subtask", {
    p_task_id: fixture.taskId,
    p_subtask_id: secondRow.id,
    p_title: null,
    p_is_completed: true,
  });

  const member = await fixture.a.rpc("calendar_tasks", {
    p_project_id: fixture.projectId,
    ...window,
    p_include_undated: false,
  });
  expect(member.error).toBeNull();
  expect(member.data).toEqual([
    expect.objectContaining({
      id: fixture.taskId,
      due_date: "2026-09-24",
      project_name: "Isolation P",
      can_edit: true,
      subtask_done: 1,
      subtask_total: 2,
    }),
  ]);

  const outsider = await fixture.b.rpc("calendar_tasks", {
    p_project_id: fixture.projectId,
    ...window,
    p_include_undated: false,
  });
  expect(outsider.error?.code).toBe("P0002");
});

it("rejects windows longer than 42 days or reversed", async () => {
  const tooLong = await fixture.a.rpc("calendar_tasks", {
    p_project_id: fixture.projectId,
    p_from: "2026-08-31",
    p_to: "2026-10-12",
    p_include_undated: false,
  });
  expect(tooLong.error?.code).toBe("22023");
  const reversed = await fixture.a.rpc("calendar_tasks", {
    p_project_id: fixture.projectId,
    p_from: "2026-10-11",
    p_to: "2026-08-31",
    p_include_undated: false,
  });
  expect(reversed.error?.code).toBe("22023");
});

it("returns undated tasks only when asked", async () => {
  await setTask({ due_date: null });
  const without = await fixture.a.rpc("calendar_tasks", {
    p_project_id: fixture.projectId,
    ...window,
    p_include_undated: false,
  });
  expect(without.data).toEqual([]);
  const withUndated = await fixture.a.rpc("calendar_tasks", {
    p_project_id: fixture.projectId,
    ...window,
    p_include_undated: true,
  });
  expect(withUndated.data).toEqual([
    expect.objectContaining({ id: fixture.taskId, due_date: null }),
  ]);
});

it("scopes the personal calendar to the caller's assigned tasks", async () => {
  await setTask({ due_date: "2026-09-24", assignee_id: null });
  const unassigned = await fixture.a.rpc("calendar_tasks", {
    p_project_id: null,
    ...window,
    p_include_undated: false,
  });
  expect(unassigned.data).toEqual([]);

  await setTask({ assignee_id: fixture.aId });
  const assigned = await fixture.a.rpc("calendar_tasks", {
    p_project_id: null,
    ...window,
    p_include_undated: false,
  });
  expect(assigned.data).toEqual([
    expect.objectContaining({ id: fixture.taskId, project_id: fixture.projectId }),
  ]);
  const outsider = await fixture.b.rpc("calendar_tasks", {
    p_project_id: null,
    ...window,
    p_include_undated: false,
  });
  expect(outsider.error).toBeNull();
  expect(outsider.data).toEqual([]);
});

it("marks tasks read-only for viewers", async () => {
  const admin = createAdminClient();
  const joined = await admin
    .from("memberships")
    .insert({ project_id: fixture.projectId, user_id: fixture.bId, role: "viewer" });
  expect(joined.error).toBeNull();
  const viewer = await fixture.b.rpc("calendar_tasks", {
    p_project_id: fixture.projectId,
    ...window,
    p_include_undated: false,
  });
  expect(viewer.data).toEqual([expect.objectContaining({ id: fixture.taskId, can_edit: false })]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:rls -- src/test/rls/calendar.test.ts`
Expected: FAIL, because `calendar_tasks` does not exist yet (PostgREST error `PGRST202`, "Could not find the function").

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/202610020001_calendar_tasks.sql`:

```sql
-- Calendar window of tasks by due date (spec 3A). One project when
-- p_project_id is given, otherwise the caller's assigned tasks across every
-- project they belong to. Security invoker: RLS applies to every read.
create or replace function public.calendar_tasks(
  p_project_id uuid,
  p_from date,
  p_to date,
  p_include_undated boolean default false
)
returns table (
  id uuid, project_id uuid, project_name varchar, title varchar, description text,
  due_date date, priority public.task_priority, column_id uuid, column_name varchar,
  is_done boolean, assignee_id uuid, updated_at timestamptz, can_edit boolean,
  subtask_done integer, subtask_total integer
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
      coalesce(s.done, 0)::integer, coalesce(s.total, 0)::integer
    from public.tasks t
    join public.projects p on p.id = t.project_id and p.deleted_at is null
    join public.columns c on c.id = t.column_id and c.project_id = t.project_id and c.deleted_at is null
    left join lateral (
      select count(*) filter (where st.is_completed) as done, count(*) as total
      from public.subtasks st where st.task_id = t.id
    ) s on true
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
        coalesce(s.done, 0)::integer, coalesce(s.total, 0)::integer
      from public.tasks t
      join public.projects p on p.id = t.project_id and p.deleted_at is null
      join public.columns c on c.id = t.column_id and c.project_id = t.project_id and c.deleted_at is null
      left join lateral (
        select count(*) filter (where st.is_completed) as done, count(*) as total
        from public.subtasks st where st.task_id = t.id
      ) s on true
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

- [ ] **Step 4: Apply the migration and run the RLS test**

Run: `npx supabase db push` (it lists `202610020001_calendar_tasks.sql`; confirm with `y`), then `npm run test:rls -- src/test/rls/calendar.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Write the failing loader test**

Create `src/lib/calendar/load.test.ts`:

```ts
// @vitest-environment node
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { loadCalendar } from "./load";

function client(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { rpc, supabase: { rpc } as unknown as SupabaseClient };
}

describe("loadCalendar", () => {
  it("passes the window and undated flag to calendar_tasks", async () => {
    const { rpc, supabase } = client({ data: [{ id: "t1" }], error: null });
    const request = new NextRequest(
      "http://localhost:3000/api/v1/me/calendar?from=2026-08-31&to=2026-10-11&undated=1",
    );
    const response = await loadCalendar({ supabase, request, requestId: "r1", projectId: null });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("calendar_tasks", {
      p_project_id: null,
      p_from: "2026-08-31",
      p_to: "2026-10-11",
      p_include_undated: true,
    });
    expect(await response.json()).toEqual({ data: [{ id: "t1" }] });
  });

  it("rejects malformed dates without calling the database", async () => {
    const { rpc, supabase } = client({ data: [], error: null });
    const request = new NextRequest(
      "http://localhost:3000/api/v1/projects/p1/calendar?from=nope&to=2026-10-11",
    );
    const response = await loadCalendar({ supabase, request, requestId: "r1", projectId: "p1" });
    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a range rejection from the database to 422", async () => {
    const { supabase } = client({ data: null, error: { code: "22023", message: "INVALID_RANGE" } });
    const request = new NextRequest(
      "http://localhost:3000/api/v1/projects/p1/calendar?from=2026-08-31&to=2026-12-31",
    );
    const response = await loadCalendar({ supabase, request, requestId: "r1", projectId: "p1" });
    expect(response.status).toBe(422);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/lib/calendar/load.test.ts`
Expected: FAIL with "Failed to resolve import ./load".

- [ ] **Step 7: Write the loader and the two routes**

Create `src/lib/calendar/load.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { json, mapRpcError } from "@/lib/api/handler";
import { apiError } from "@/lib/api/response";

export const calendarQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  undated: z.enum(["0", "1"]).optional(),
});

export async function loadCalendar({
  supabase,
  request,
  requestId,
  projectId,
}: {
  supabase: SupabaseClient;
  request: NextRequest;
  requestId: string;
  projectId: string | null;
}): Promise<Response> {
  const query = calendarQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) {
    return apiError(422, "VALIDATION_ERROR", "Choose a valid date range.", query.error.flatten());
  }
  const { data, error } = await supabase.rpc("calendar_tasks", {
    p_project_id: projectId,
    p_from: query.data.from,
    p_to: query.data.to,
    p_include_undated: query.data.undated === "1",
  });
  if (error)
    return mapRpcError(error, {
      message: projectId ? "Calendar could not be loaded." : "Your calendar could not be loaded.",
      requestId,
      projectScoped: projectId !== null,
    });
  return json({ data: data ?? [] });
}
```

Create `src/app/api/v1/projects/[projectId]/calendar/route.ts`:

```ts
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { loadCalendar } from "@/lib/calendar/load";

export const GET = withApiHandler(
  {
    params: z.object({ projectId: z.string().uuid() }),
    rateLimit: RATE_LIMITS.reads,
    notFoundMessage: "Project not found.",
  },
  async ({ supabase, request, params, requestId }) =>
    loadCalendar({ supabase, request, requestId, projectId: params.projectId }),
);
```

Create `src/app/api/v1/me/calendar/route.ts`:

```ts
import { withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { loadCalendar } from "@/lib/calendar/load";

export const GET = withApiHandler(
  { rateLimit: RATE_LIMITS.reads, unauthenticatedMessage: "Sign in to see your calendar." },
  async ({ supabase, request, requestId }) =>
    loadCalendar({ supabase, request, requestId, projectId: null }),
);
```

- [ ] **Step 8: Run the tests and checks**

Run: `npx vitest run src/lib/calendar/load.test.ts`, then `npm run typecheck`, then `npm run lint`
Expected: 3 passed. Typecheck and lint are clean.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/202610020001_calendar_tasks.sql src/lib/calendar/load.ts src/lib/calendar/load.test.ts "src/app/api/v1/projects/[projectId]/calendar/route.ts" src/app/api/v1/me/calendar/route.ts src/test/rls/calendar.test.ts
git commit -m "feat(calendar): add calendar_tasks RPC and calendar routes"
```

---

### Task 2: Calendar date math

**Files:**
- Create: `src/lib/calendar/grid.ts`
- Test: `src/lib/calendar/grid.test.ts`

**Interfaces:**
- Produces, in `src/lib/calendar/grid.ts`:
  - `type CalendarView = "month" | "week"`
  - `MAX_CHIPS_PER_DAY = 3`
  - `addDays(date, days): string`
  - `startOfWeek(date): string`
  - `firstOfMonth(date): string`
  - `visibleDays(view, anchor): string[]`
  - `visibleRange(view, anchor): { from; to }`
  - `shiftAnchor(view, anchor, -1 | 1): string`
  - `groupByDueDate<T extends { due_date: string | null }>(tasks): Map<string, T[]>`
  - `monthLabel(anchor): string`
- All dates are `YYYY-MM-DD` strings, and all arithmetic is done in UTC.

- [ ] **Step 1: Write the failing test**

Create `src/lib/calendar/grid.test.ts`. These expected values were executed by the plan author and match:

```ts
import { describe, expect, it } from "vitest";
import {
  groupByDueDate,
  monthLabel,
  shiftAnchor,
  startOfWeek,
  visibleDays,
  visibleRange,
} from "./grid";

describe("calendar grid", () => {
  it("builds a 42-day Monday-first month grid", () => {
    const days = visibleDays("month", "2026-09-24");
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-08-31");
    expect(days[41]).toBe("2026-10-11");
    expect(visibleRange("month", "2026-09-24")).toEqual({ from: "2026-08-31", to: "2026-10-11" });
  });

  it("handles months starting on a Sunday or a Monday", () => {
    const february = visibleDays("month", "2026-02-10");
    expect([february[0], february[41]]).toEqual(["2026-01-26", "2026-03-08"]);
    const march = visibleDays("month", "2027-03-15");
    expect([march[0], march[41]]).toEqual(["2027-03-01", "2027-04-11"]);
  });

  it("builds a Monday-to-Sunday week", () => {
    expect(visibleDays("week", "2026-09-24")).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
    ]);
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21");
    expect(startOfWeek("2026-09-21")).toBe("2026-09-21");
  });

  it("shifts months by calendar month and weeks by seven days", () => {
    expect(shiftAnchor("month", "2026-01-31", -1)).toBe("2025-12-01");
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftAnchor("month", "2026-12-05", 1)).toBe("2027-01-01");
    expect(shiftAnchor("week", "2026-12-30", 1)).toBe("2027-01-06");
  });

  it("groups dated tasks and skips undated ones", () => {
    const groups = groupByDueDate([
      { id: "a", due_date: "2026-09-24" },
      { id: "b", due_date: null },
      { id: "c", due_date: "2026-09-24" },
    ]);
    expect([...groups]).toEqual([
      [
        "2026-09-24",
        [
          { id: "a", due_date: "2026-09-24" },
          { id: "c", due_date: "2026-09-24" },
        ],
      ],
    ]);
  });

  it("labels the anchor month", () => {
    expect(monthLabel("2026-09-24")).toBe("September 2026");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/calendar/grid.test.ts`
Expected: FAIL with "Failed to resolve import ./grid".

- [ ] **Step 3: Write the implementation**

Create `src/lib/calendar/grid.ts`:

```ts
export type CalendarView = "month" | "week";
export const MAX_CHIPS_PER_DAY = 3;

function parts(date: string): [number, number, number] {
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  return [year, month, day];
}

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = parts(date);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return toDateString(value);
}

export function startOfWeek(date: string): string {
  const [year, month, day] = parts(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function visibleDays(view: CalendarView, anchor: string): string[] {
  const start = startOfWeek(view === "month" ? firstOfMonth(anchor) : anchor);
  const count = view === "month" ? 42 : 7;
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

export function visibleRange(view: CalendarView, anchor: string): { from: string; to: string } {
  const days = visibleDays(view, anchor);
  return { from: days[0]!, to: days[days.length - 1]! };
}

export function shiftAnchor(view: CalendarView, anchor: string, direction: -1 | 1): string {
  if (view === "week") return addDays(anchor, 7 * direction);
  const [year, month] = parts(anchor);
  return toDateString(new Date(Date.UTC(year, month - 1 + direction, 1)));
}

export function groupByDueDate<T extends { due_date: string | null }>(
  tasks: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const task of tasks) {
    if (!task.due_date) continue;
    groups.set(task.due_date, [...(groups.get(task.due_date) ?? []), task]);
  }
  return groups;
}

export function monthLabel(anchor: string): string {
  const [year, month] = parts(anchor);
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/calendar/grid.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar/grid.ts src/lib/calendar/grid.test.ts
git commit -m "feat(calendar): add month and week grid date math"
```

---

### Task 3: `useCalendarTasks` hook (load and reschedule)

**Files:**
- Create: `src/components/calendar/use-calendar-tasks.ts`
- Test: `src/components/calendar/use-calendar-tasks.test.tsx`

**Interfaces:**
- Consumes: `GET` calendar routes (Task 1); `PATCH /api/v1/tasks/[taskId]` with body `{ title, description, priority, dueDate, assigneeId, expectedUpdatedAt }`. It returns `{ data: task }`, or 409 with `{ error: { details: { current: task } } }`.
- Produces:
  - `type CalendarTask` (the RPC row shape).
  - `type CalendarSource = { kind: "project"; projectId: string } | { kind: "me" }`.
  - `calendarUrl(source, range, includeUndated): string`.
  - `useCalendarTasks(source, range)`, which returns `{ tasks, undated, loading, error, message, refresh, reschedule(taskId, dueDate): Promise<void> }`.

- [ ] **Step 1: Write the failing test**

Create `src/components/calendar/use-calendar-tasks.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCalendarTasks, type CalendarTask } from "./use-calendar-tasks";

afterEach(() => vi.unstubAllGlobals());

const row: CalendarTask = {
  id: "t1",
  project_id: "p1",
  project_name: "Launch",
  title: "Write brief",
  description: null,
  due_date: "2026-09-24",
  priority: "medium",
  column_id: "c1",
  column_name: "To do",
  is_done: false,
  assignee_id: null,
  updated_at: "2026-09-01T00:00:00Z",
  can_edit: true,
  subtask_done: 0,
  subtask_total: 0,
};
const undatedRow: CalendarTask = { ...row, id: "t2", title: "Someday", due_date: null };
const source = { kind: "project", projectId: "p1" } as const;
const range = { from: "2026-08-31", to: "2026-10-11" };
const loaded = (rows: CalendarTask[]) => ({ ok: true, status: 200, json: async () => ({ data: rows }) });

async function mount(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const hook = renderHook(() => useCalendarTasks(source, range));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("useCalendarTasks", () => {
  it("loads undated tasks on the first request and splits them out", async () => {
    const fetchMock = vi.fn().mockResolvedValue(loaded([row, undatedRow]));
    const { result } = await mount(fetchMock);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "/api/v1/projects/p1/calendar?from=2026-08-31&to=2026-10-11&undated=1",
    );
    expect(result.current.tasks.map((task) => task.id)).toEqual(["t1"]);
    expect(result.current.undated.map((task) => task.id)).toEqual(["t2"]);
  });

  it("does not show a task twice when a refresh finds it newly scheduled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loaded([row, undatedRow]))
      .mockResolvedValueOnce(loaded([row, { ...undatedRow, due_date: "2026-09-26" }]));
    const { result } = await mount(fetchMock);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.tasks).toHaveLength(2));
    expect(fetchMock.mock.calls[1]![0]).toBe(
      "/api/v1/projects/p1/calendar?from=2026-08-31&to=2026-10-11",
    );
    expect(result.current.undated).toEqual([]);
  });

  it("reschedules with the full task payload and the last seen version", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loaded([row]))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { ...row, due_date: "2026-09-30", updated_at: "2026-09-02T00:00:00Z" },
        }),
      });
    const { result } = await mount(fetchMock);
    await act(async () => {
      await result.current.reschedule("t1", "2026-09-30");
    });
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("/api/v1/tasks/t1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({
      title: "Write brief",
      description: null,
      priority: "medium",
      dueDate: "2026-09-30",
      assigneeId: null,
      expectedUpdatedAt: "2026-09-01T00:00:00Z",
    });
    expect(result.current.tasks[0]).toMatchObject({
      due_date: "2026-09-30",
      updated_at: "2026-09-02T00:00:00Z",
    });
  });

  it("shows the latest date after a conflict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loaded([row]))
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            details: {
              current: { ...row, due_date: "2026-09-25", updated_at: "2026-09-03T00:00:00Z" },
            },
          },
        }),
      });
    const { result } = await mount(fetchMock);
    await act(async () => {
      await result.current.reschedule("t1", "2026-09-30");
    });
    expect(result.current.tasks[0]).toMatchObject({
      due_date: "2026-09-25",
      updated_at: "2026-09-03T00:00:00Z",
    });
    expect(result.current.message).toMatch(/changed elsewhere/);
  });

  it("returns an undated task to the tray when scheduling fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loaded([undatedRow]))
      .mockRejectedValueOnce(new Error("offline"));
    const { result } = await mount(fetchMock);
    await act(async () => {
      await result.current.reschedule("t2", "2026-09-26");
    });
    expect(result.current.tasks).toEqual([]);
    expect(result.current.undated.map((task) => task.id)).toEqual(["t2"]);
    expect(result.current.message).toMatch(/could not be changed/);
  });

  it("moves an undated task onto a day when scheduling succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loaded([undatedRow]))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { ...undatedRow, due_date: "2026-09-26", updated_at: "2026-09-02T00:00:00Z" },
        }),
      });
    const { result } = await mount(fetchMock);
    await act(async () => {
      await result.current.reschedule("t2", "2026-09-26");
    });
    expect(result.current.undated).toEqual([]);
    expect(result.current.tasks[0]).toMatchObject({ id: "t2", due_date: "2026-09-26" });
  });

  it("never sends a request for a task the caller cannot edit", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(loaded([{ ...row, can_edit: false }]));
    const { result } = await mount(fetchMock);
    await act(async () => {
      await result.current.reschedule("t1", "2026-09-30");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.tasks[0]!.due_date).toBe("2026-09-24");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/calendar/use-calendar-tasks.test.tsx`
Expected: FAIL with "Failed to resolve import ./use-calendar-tasks".

- [ ] **Step 3: Write the hook**

Create `src/components/calendar/use-calendar-tasks.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardTask } from "@/components/board/project-board";

export type CalendarTask = {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: BoardTask["priority"];
  column_id: string;
  column_name: string;
  is_done: boolean;
  assignee_id: string | null;
  updated_at: string;
  can_edit: boolean;
  subtask_done: number;
  subtask_total: number;
};

export type CalendarSource = { kind: "project"; projectId: string } | { kind: "me" };

type Versioned = Pick<CalendarTask, "due_date" | "updated_at">;
type SavePayload = { data?: Versioned; error?: { details?: { current?: Versioned } } };

export function calendarUrl(
  source: CalendarSource,
  range: { from: string; to: string },
  includeUndated: boolean,
): string {
  const base =
    source.kind === "project"
      ? `/api/v1/projects/${source.projectId}/calendar`
      : "/api/v1/me/calendar";
  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (includeUndated) params.set("undated", "1");
  return `${base}?${params}`;
}

export function useCalendarTasks(source: CalendarSource, range: { from: string; to: string }) {
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [undated, setUndated] = useState<CalendarTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const undatedLoaded = useRef(false);
  const pending = useRef(new Set<string>());
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const url = calendarUrl(source, range, false);

  useEffect(() => {
    const controller = new AbortController();
    const includeUndated = !undatedLoaded.current;
    void fetch(includeUndated ? `${url}&undated=1` : url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Calendar unavailable");
        return (await response.json()) as { data?: unknown };
      })
      .then((body) => {
        if (!Array.isArray(body.data)) throw new Error("Invalid calendar response");
        if (controller.signal.aborted) return;
        const rows = body.data as CalendarTask[];
        const dated = rows.filter((task) => task.due_date !== null);
        const datedIds = new Set(dated.map((task) => task.id));
        setTasks(dated);
        if (includeUndated) {
          undatedLoaded.current = true;
          setUndated(rows.filter((task) => task.due_date === null));
        } else {
          setUndated((current) => current.filter((task) => !datedIds.has(task.id)));
        }
        setError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, revision]);

  function place(task: CalendarTask) {
    setTasks((current) => [
      ...current.filter((candidate) => candidate.id !== task.id),
      ...(task.due_date ? [task] : []),
    ]);
    setUndated((current) => [
      ...current.filter((candidate) => candidate.id !== task.id),
      ...(task.due_date ? [] : [task]),
    ]);
  }

  async function reschedule(taskId: string, dueDate: string) {
    const task = [...tasks, ...undated].find((candidate) => candidate.id === taskId);
    if (!task || !task.can_edit || task.due_date === dueDate || pending.current.has(taskId)) return;
    pending.current.add(taskId);
    setMessage(null);
    place({ ...task, due_date: dueDate });
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDate,
          assigneeId: task.assignee_id,
          expectedUpdatedAt: task.updated_at,
        }),
      });
      const payload = (await response.json()) as SavePayload;
      const latest = payload.error?.details?.current;
      if (response.status === 409 && latest) {
        place({ ...task, due_date: latest.due_date, updated_at: latest.updated_at });
        setMessage("This task changed elsewhere. Its latest date is shown; try again.");
        return;
      }
      if (!response.ok || !payload.data) throw new Error("Reschedule rejected");
      place({ ...task, due_date: payload.data.due_date, updated_at: payload.data.updated_at });
    } catch {
      place(task);
      setMessage("The due date could not be changed. The task was returned to where it was.");
    } finally {
      pending.current.delete(taskId);
    }
  }

  return { tasks, undated, loading, error, message, refresh, reschedule };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/components/calendar/use-calendar-tasks.test.tsx`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/use-calendar-tasks.ts src/components/calendar/use-calendar-tasks.test.tsx
git commit -m "feat(calendar): add calendar data hook with optimistic reschedule"
```

---

### Task 4: Calendar grid and view components

**Files:**
- Create: `src/components/calendar/calendar-grid.tsx`
- Create: `src/components/calendar/calendar-view.tsx`
- Test: `src/components/calendar/calendar-grid.test.tsx`

**Interfaces:**
- Consumes: `grid.ts` (Task 2), and `useCalendarTasks`, `CalendarTask`, `CalendarSource` (Task 3). Also `useProjectChannel(projectId, currentUserId, { onTask, onColumn, onMembershipRemoved })` from `@/lib/realtime/use-project-channel`, and `todayInTimeZone(now, timeZone)` from `@/lib/filters/timezone`.
- Produces:
  - `CalendarGrid({ view, days, month, today, tasksByDay, showProject })`.
  - `CalendarChip({ task, showProject })`.
  - `CalendarView({ source, initialAnchor, timeZone?, currentUserId })`.
  - Droppable ids are `day:YYYY-MM-DD` with `data.day`. Draggable ids are the task id.
- Clicking a chip goes to `/p/{project_id}/board?task={id}`. The board already opens `TaskDetailDrawer` from `?task=`, the same deep link that notifications and the Timeline use.

- [ ] **Step 1: Write the failing test**

Create `src/components/calendar/calendar-grid.test.tsx`:

```tsx
import { DndContext } from "@dnd-kit/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { visibleDays } from "@/lib/calendar/grid";
import { CalendarGrid } from "./calendar-grid";
import type { CalendarTask } from "./use-calendar-tasks";

const base: CalendarTask = {
  id: "t0",
  project_id: "p1",
  project_name: "Launch",
  title: "Task 0",
  description: null,
  due_date: "2026-09-24",
  priority: "medium",
  column_id: "c1",
  column_name: "To do",
  is_done: false,
  assignee_id: null,
  updated_at: "2026-09-01T00:00:00Z",
  can_edit: true,
  subtask_done: 0,
  subtask_total: 0,
};
const five = Array.from({ length: 5 }, (_, index) => ({
  ...base,
  id: `t${index}`,
  title: `Task ${index}`,
}));

function renderGrid(showProject = false) {
  return render(
    <DndContext>
      <CalendarGrid
        view="month"
        days={visibleDays("month", "2026-09-24")}
        month="2026-09"
        today="2026-09-24"
        tasksByDay={new Map([["2026-09-24", five]])}
        showProject={showProject}
      />
    </DndContext>,
  );
}

it("renders 42 days and marks today", () => {
  renderGrid();
  expect(screen.getAllByRole("gridcell")).toHaveLength(42);
  const today = screen.getByRole("gridcell", { name: "Thursday, September 24" });
  expect(today).toHaveAttribute("aria-current", "date");
});

it("shows three chips per day and expands the rest", async () => {
  renderGrid();
  const today = screen.getByRole("gridcell", { name: "Thursday, September 24" });
  expect(within(today).getAllByRole("link")).toHaveLength(3);
  await userEvent.click(within(today).getByRole("button", { name: "+2 more" }));
  expect(within(today).getAllByRole("link")).toHaveLength(5);
});

it("links chips to the task drawer on the board", () => {
  renderGrid(true);
  expect(screen.getByRole("link", { name: "Task 0" })).toHaveAttribute(
    "href",
    "/p/p1/board?task=t0",
  );
  expect(screen.getAllByText("Launch").length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/calendar/calendar-grid.test.tsx`
Expected: FAIL with "Failed to resolve import ./calendar-grid".

- [ ] **Step 3: Write the grid**

Create `src/components/calendar/calendar-grid.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CheckCircle2 } from "lucide-react";
import { MAX_CHIPS_PER_DAY, type CalendarView } from "@/lib/calendar/grid";
import { cn } from "@/lib/utils";
import type { CalendarTask } from "./use-calendar-tasks";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayLabel(day: string): string {
  const [year = 0, month = 0, date = 0] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}

export function CalendarGrid({
  view,
  days,
  month,
  today,
  tasksByDay,
  showProject,
}: {
  view: CalendarView;
  days: string[];
  month: string;
  today: string | null;
  tasksByDay: Map<string, CalendarTask[]>;
  showProject: boolean;
}) {
  return (
    <div role="grid" aria-label="Calendar" className="mt-4 overflow-x-auto rounded-xl border">
      <div role="row" className="bg-muted/50 grid min-w-[42rem] grid-cols-7 border-b">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            role="columnheader"
            className="text-muted-foreground px-2 py-2 text-xs font-medium uppercase"
          >
            {weekday}
          </div>
        ))}
      </div>
      {Array.from({ length: days.length / 7 }, (_, week) => (
        <div key={week} role="row" className="grid min-w-[42rem] grid-cols-7">
          {days.slice(week * 7, week * 7 + 7).map((day) => (
            <CalendarDay
              key={day}
              day={day}
              tasks={tasksByDay.get(day) ?? []}
              outside={view === "month" && !day.startsWith(month)}
              isToday={day === today}
              tall={view === "week"}
              showProject={showProject}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function CalendarDay({
  day,
  tasks,
  outside,
  isToday,
  tall,
  showProject,
}: {
  day: string;
  tasks: CalendarTask[];
  outside: boolean;
  isToday: boolean;
  tall: boolean;
  showProject: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { isOver, setNodeRef } = useDroppable({ id: `day:${day}`, data: { day } });
  const visible = expanded ? tasks : tasks.slice(0, MAX_CHIPS_PER_DAY);
  const hidden = tasks.length - visible.length;
  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-label={dayLabel(day)}
      aria-current={isToday ? "date" : undefined}
      className={cn(
        "min-h-28 border-r border-b p-1.5 last:border-r-0",
        tall && "min-h-80",
        outside && "bg-muted/30 text-muted-foreground",
        isOver && "ring-primary ring-2 ring-inset",
      )}
    >
      <span
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-full text-xs",
          isToday && "bg-primary text-primary-foreground font-semibold",
        )}
      >
        {Number(day.slice(8))}
      </span>
      <ul className="mt-1 space-y-1">
        {visible.map((task) => (
          <li key={task.id}>
            <CalendarChip task={task} showProject={showProject} />
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mt-1 rounded text-xs focus-visible:ring-2 focus-visible:outline-none"
        >
          +{hidden} more
        </button>
      )}
    </div>
  );
}

export function CalendarChip({ task, showProject }: { task: CalendarTask; showProject: boolean }) {
  const { listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { taskId: task.id },
    disabled: !task.can_edit,
  });
  const details = [
    showProject ? task.project_name : null,
    task.subtask_total > 0 ? `${task.subtask_done}/${task.subtask_total} subtasks` : null,
  ].filter(Boolean);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...(task.can_edit ? listeners : {})}
      className={cn(
        "bg-card rounded-md border px-1.5 py-1 text-xs",
        task.can_edit && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50",
      )}
    >
      <Link
        href={`/p/${task.project_id}/board?task=${task.id}`}
        className={cn(
          "focus-visible:ring-ring block truncate rounded font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none",
          task.is_done && "text-muted-foreground line-through",
        )}
      >
        {task.is_done && <CheckCircle2 aria-label="Completed" className="mr-1 inline size-3" />}
        {task.title}
      </Link>
      {details.length > 0 && <p className="text-muted-foreground truncate">{details.join(" · ")}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Write the view**

Create `src/components/calendar/calendar-view.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  groupByDueDate,
  monthLabel,
  shiftAnchor,
  visibleDays,
  type CalendarView as View,
} from "@/lib/calendar/grid";
import { todayInTimeZone } from "@/lib/filters/timezone";
import { useProjectChannel } from "@/lib/realtime/use-project-channel";
import { CalendarChip, CalendarGrid } from "./calendar-grid";
import { useCalendarTasks, type CalendarSource } from "./use-calendar-tasks";

export function CalendarView({
  source,
  initialAnchor,
  timeZone,
  currentUserId,
}: {
  source: CalendarSource;
  initialAnchor: string;
  timeZone?: string;
  currentUserId: string;
}) {
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(initialAnchor);
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timer = window.setTimeout(() => setToday(todayInTimeZone(new Date(), zone)), 0);
    return () => window.clearTimeout(timer);
  }, [timeZone]);

  const days = useMemo(() => visibleDays(view, anchor), [view, anchor]);
  const calendar = useCalendarTasks(source, { from: days[0]!, to: days[days.length - 1]! });
  const tasksByDay = useMemo(() => groupByDueDate(calendar.tasks), [calendar.tasks]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function onDragEnd(event: DragEndEvent) {
    const day: unknown = event.over?.data.current?.day;
    if (typeof day === "string") void calendar.reschedule(String(event.active.id), day);
  }

  const heading =
    view === "month"
      ? monthLabel(anchor)
      : `Week of ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${days[0]}T00:00:00Z`))}`;

  return (
    <section aria-label="Task calendar" className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={view === "month" ? "Previous month" : "Previous week"}
            onClick={() => setAnchor((current) => shiftAnchor(view, current, -1))}
          >
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(today ?? initialAnchor)}>
            Today
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={view === "month" ? "Next month" : "Next week"}
            onClick={() => setAnchor((current) => shiftAnchor(view, current, 1))}
          >
            <ChevronRight />
          </Button>
          <h2 className="text-headline-md ml-2 font-serif" aria-live="polite">
            {heading}
          </h2>
        </div>
        <div role="group" aria-label="Calendar range" className="flex gap-1">
          {(["month", "week"] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={view === option ? "default" : "ghost"}
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >
              {option === "month" ? "Month" : "Week"}
            </Button>
          ))}
        </div>
      </div>
      {calendar.message && (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {calendar.message}
        </p>
      )}
      {calendar.error && (
        <div role="alert" className="mt-3 text-sm">
          <p>The calendar could not be loaded.</p>
          <Button variant="outline" className="mt-2" onClick={calendar.refresh}>
            Try again
          </Button>
        </div>
      )}
      {calendar.loading && (
        <p role="status" className="text-muted-foreground mt-3 text-sm">
          Loading calendar…
        </p>
      )}
      <DndContext id="calendar" sensors={sensors} onDragEnd={onDragEnd}>
        <CalendarGrid
          view={view}
          days={days}
          month={anchor.slice(0, 7)}
          today={today}
          tasksByDay={tasksByDay}
          showProject={source.kind === "me"}
        />
        <details className="mt-4 rounded-xl border p-3" open={calendar.undated.length > 0}>
          <summary className="cursor-pointer text-sm font-medium">
            No due date ({calendar.undated.length})
          </summary>
          <p className="text-muted-foreground mt-1 text-xs">Drag a task onto a day to schedule it.</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {calendar.undated.map((task) => (
              <li key={task.id}>
                <CalendarChip task={task} showProject={source.kind === "me"} />
              </li>
            ))}
          </ul>
        </details>
      </DndContext>
      {source.kind === "project" && (
        <ProjectRealtime
          projectId={source.projectId}
          currentUserId={currentUserId}
          onChange={calendar.refresh}
        />
      )}
    </section>
  );
}

function ProjectRealtime({
  projectId,
  currentUserId,
  onChange,
}: {
  projectId: string;
  currentUserId: string;
  onChange: () => void;
}) {
  const router = useRouter();
  useProjectChannel(projectId, currentUserId, {
    onTask: onChange,
    onColumn: onChange,
    onMembershipRemoved: () => router.replace("/projects?removed=1"),
  });
  return null;
}
```

- [ ] **Step 5: Run the tests and checks**

Run: `npx vitest run src/components/calendar`, then `npm run typecheck`, then `npm run lint`
Expected: all calendar tests pass (3 grid + 7 hook). Typecheck and lint are clean. If `Button` has no `size="icon-sm"`, check `src/components/ui/button.tsx`; the board already uses `icon-sm`, so it exists.

- [ ] **Step 6: Commit**

```bash
git add src/components/calendar/calendar-grid.tsx src/components/calendar/calendar-view.tsx src/components/calendar/calendar-grid.test.tsx
git commit -m "feat(calendar): add drag-to-reschedule month and week calendar view"
```

---

### Task 5: Calendar pages, project tab and My Tasks toggle

**Files:**
- Create: `src/app/(app)/p/[projectId]/calendar/page.tsx`
- Modify: `src/components/project-nav.tsx` (the `links` array)
- Modify: `src/app/(app)/my-tasks/page.tsx`

**Interfaces:**
- Consumes: `CalendarView` (Task 4) and `todayInTimeZone` from `@/lib/filters/timezone`.
- Produces the routes `/p/[projectId]/calendar` and `/my-tasks?view=calendar`.

- [ ] **Step 1: Create the project calendar page**

Create `src/app/(app)/p/[projectId]/calendar/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { CalendarView } from "@/components/calendar/calendar-view";
import { todayInTimeZone } from "@/lib/filters/timezone";
import { createClient } from "@/lib/supabase/server";

export default async function CalendarPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    { data: project },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("projects")
      .select("name, timezone")
      .eq("id", projectId)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);
  if (!user || !project) notFound();
  return (
    <main className="p-4 sm:p-7">
      <h1 className="text-headline-lg font-serif">Calendar</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        {project.name} · Drag a task to another day to change its due date
      </p>
      <CalendarView
        source={{ kind: "project", projectId }}
        initialAnchor={todayInTimeZone(new Date(), project.timezone)}
        timeZone={project.timezone}
        currentUserId={user.id}
      />
    </main>
  );
}
```

- [ ] **Step 2: Add the Calendar tab**

In `src/components/project-nav.tsx`, add `CalendarDays` to the `lucide-react` import list (alphabetical, after `Calendar`), and add this entry to `links` directly after the Timeline entry:

```tsx
    { label: "Calendar", href: `${base}/calendar`, icon: CalendarDays, filters: false },
```

- [ ] **Step 3: Add the List / Calendar toggle to My Tasks**

In `src/app/(app)/my-tasks/page.tsx`:
1. Change the signature to `export default async function MyTasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> })`. As the first line, add `const { view } = await searchParams;` and `const showCalendar = view === "calendar";`.
2. Add the imports `import Link from "next/link";`, `import { CalendarView } from "@/components/calendar/calendar-view";` and `import { todayInTimeZone } from "@/lib/filters/timezone";`.
3. Directly after the description `<p>`, insert:

```tsx
      <nav aria-label="My Tasks views" className="mt-4 flex gap-1">
        {[
          { label: "List", href: "/my-tasks", active: !showCalendar },
          { label: "Calendar", href: "/my-tasks?view=calendar", active: showCalendar },
        ].map((option) => (
          <Link
            key={option.label}
            href={option.href}
            aria-current={option.active ? "page" : undefined}
            className={
              option.active
                ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium"
                : "text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-sm font-medium"
            }
          >
            {option.label}
          </Link>
        ))}
      </nav>
```

4. Replace the error-or-list ternary with:

```tsx
      {showCalendar ? (
        <CalendarView
          source={{ kind: "me" }}
          initialAnchor={todayInTimeZone(new Date(), "UTC")}
          currentUserId={auth.user.id}
        />
      ) : error ? (
        <p role="alert" className="text-destructive mt-10 text-sm">
          Your tasks could not be loaded. Refresh to try again.
        </p>
      ) : (
        <MyTasksList tasks={tasks} now={new Date()} />
      )}
```

5. Widen the page when the calendar is shown: change `<main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">` to ``<main className={`mx-auto px-4 py-8 sm:px-6 ${showCalendar ? "max-w-6xl" : "max-w-4xl"}`}>``.

- [ ] **Step 4: Verify**

Run: `npm run typecheck`, then `npm run lint`, then `npm test`, then `npm run build`
Expected: all clean. The build lists `/p/[projectId]/calendar` and `/api/v1/me/calendar`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/p/[projectId]/calendar/page.tsx" src/components/project-nav.tsx "src/app/(app)/my-tasks/page.tsx"
git commit -m "feat(calendar): add project Calendar tab and My Tasks calendar toggle"
```

---

### Task 6: Subtask-progress chip on board cards and list rows

**Files:**
- Create: `src/lib/tasks/subtask-counts.ts`
- Create: `src/lib/tasks/subtask-counts.test.ts`
- Create: `src/components/tasks/subtask-progress.tsx`
- Create: `src/components/tasks/subtask-progress.test.tsx`
- Modify: `src/components/board/project-board.tsx` (the `BoardTask` type, `TaskCard`, and the `TaskDetailDrawer` usage)
- Modify: `src/components/board/task-detail-drawer.tsx` (props, and `SubtaskList` mutations)
- Modify: `src/components/list/task-table.tsx` (title cell)
- Modify: `src/components/list/project-task-list.tsx` (the `TaskDetailDrawer` usage)
- Modify: `src/app/(app)/p/[projectId]/board/page.tsx` and `src/app/(app)/p/[projectId]/list/page.tsx` (task queries)

**Interfaces:**
- Produces:
  - `subtaskCounts(rows): { subtask_done: number; subtask_total: number }`.
  - `SubtaskProgress({ done, total })`.
  - `BoardTask` gains `subtask_done?: number; subtask_total?: number`.
  - `TaskDetailDrawer` gains an optional prop `onSubtaskCountsChange?: (done: number, total: number) => void`.
- Realtime `mergeTaskEvent` spreads the existing task (`{ ...task, ...toBoardTask(row) }`), so the counts survive realtime updates. Tasks created through realtime have no counts, and the chip stays hidden for them.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/tasks/subtask-counts.test.ts`:

```ts
import { expect, it } from "vitest";
import { subtaskCounts } from "./subtask-counts";

it("counts completed and total subtasks", () => {
  expect(
    subtaskCounts([{ is_completed: true }, { is_completed: false }, { is_completed: true }]),
  ).toEqual({ subtask_done: 2, subtask_total: 3 });
  expect(subtaskCounts(null)).toEqual({ subtask_done: 0, subtask_total: 0 });
});
```

Create `src/components/tasks/subtask-progress.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SubtaskProgress } from "./subtask-progress";

it("shows progress with an accessible description", () => {
  render(<SubtaskProgress done={2} total={5} />);
  expect(screen.getByText("2/5")).toBeInTheDocument();
  expect(screen.getByText("2 of 5 subtasks complete")).toBeInTheDocument();
});

it("renders nothing without subtasks", () => {
  const { container } = render(<SubtaskProgress done={0} total={0} />);
  expect(container).toBeEmptyDOMElement();
});
```

Append to `src/components/board/task-detail-drawer.test.tsx`:

```tsx
it("reports subtask counts after adding a subtask", async () => {
  const onSubtaskCountsChange = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { id: "s1", task_id: "t1", title: "Draft", is_completed: false, position: 1 },
        }),
      }),
  );
  render(<TaskDetailDrawer {...props} onSubtaskCountsChange={onSubtaskCountsChange} />);
  await userEvent.type(await screen.findByLabelText("New subtask title"), "Draft");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(onSubtaskCountsChange).toHaveBeenCalledWith(0, 1));
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/tasks/subtask-counts.test.ts src/components/tasks/subtask-progress.test.tsx src/components/board/task-detail-drawer.test.tsx`
Expected: FAIL. The first two fail with "Failed to resolve import". The drawer test fails because `onSubtaskCountsChange` is never called.

- [ ] **Step 3: Write the helper and chip**

Create `src/lib/tasks/subtask-counts.ts`:

```ts
export function subtaskCounts(rows: { is_completed: boolean }[] | null | undefined): {
  subtask_done: number;
  subtask_total: number;
} {
  const list = rows ?? [];
  return {
    subtask_done: list.filter((row) => row.is_completed).length,
    subtask_total: list.length,
  };
}
```

Create `src/components/tasks/subtask-progress.tsx`:

```tsx
import { ListChecks } from "lucide-react";

export function SubtaskProgress({ done, total }: { done: number; total: number }) {
  if (total === 0) return null;
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <ListChecks className="size-3" aria-hidden="true" />
      <span aria-hidden="true">
        {done}/{total}
      </span>
      <span className="sr-only">
        {done} of {total} subtasks complete
      </span>
    </span>
  );
}
```

- [ ] **Step 4: Report counts from the drawer's SubtaskList**

In `src/components/board/task-detail-drawer.tsx`:
1. Add `onSubtaskCountsChange?: (done: number, total: number) => void;` to the `TaskDetailDrawer` props type, and `onSubtaskCountsChange` to its destructured parameters.
2. Change the usage to `<SubtaskList taskId={task.id} readOnly={readOnly} onCountsChange={onSubtaskCountsChange} />`.
3. Change the `SubtaskList` signature to:

```tsx
function SubtaskList({
  taskId,
  readOnly,
  onCountsChange,
}: {
  taskId: string;
  readOnly: boolean;
  onCountsChange?: (done: number, total: number) => void;
}) {
```

4. Inside `SubtaskList`, add this helper directly after the `useEffect`, and use it in place of the three `setSubtasks((current) => …)` calls in `addSubtask`, `updateSubtask` and `removeSubtask`:

```tsx
  function commit(next: Subtask[]) {
    setSubtasks(next);
    onCountsChange?.(next.filter((subtask) => subtask.is_completed).length, next.length);
  }
```

The three call sites become:
- `commit([...subtasks, payload.data]);`
- `commit(subtasks.map((item) => (item.id === subtask.id ? payload.data : item)));`
- `commit(subtasks.filter((item) => item.id !== subtask.id));`

- [ ] **Step 5: Load counts and render the chip**

In both `src/app/(app)/p/[projectId]/board/page.tsx` and `src/app/(app)/p/[projectId]/list/page.tsx`:
- Append `, subtasks(is_completed)` to the `tasks` select string, right after `task_labels(labels(id, name, color))`.
- Add `import { subtaskCounts } from "@/lib/tasks/subtask-counts";`.
- In the task mapping, destructure the embed out and add the counts. In the board page this becomes:

```tsx
  const tasks = (taskData ?? []).map(({ subtasks, ...task }) => ({
    ...task,
    ...subtaskCounts(subtasks),
    labels: (task.task_labels ?? []).flatMap((taskLabel) => {
      const label = Array.isArray(taskLabel.labels) ? taskLabel.labels[0] : taskLabel.labels;
      return label ? [{ id: label.id, name: label.name, color: label.color }] : [];
    }),
  })) as BoardTask[];
```

In the list page, apply the same change to `(tasksResult.data ?? []).map(...)`, keeping its existing `relation` naming.

In `src/components/board/project-board.tsx`:
- Add `subtask_done?: number;` and `subtask_total?: number;` to `BoardTask`.
- Add `import { SubtaskProgress } from "@/components/tasks/subtask-progress";`.
- In `TaskCard`, inside the `<div className="mt-3 flex items-center justify-between gap-2 text-xs">` row, directly after the priority `<span>`, add `<SubtaskProgress done={task.subtask_done ?? 0} total={task.subtask_total ?? 0} />`.
- On the `TaskDetailDrawer` element, add:

```tsx
          onSubtaskCountsChange={(done, total) =>
            setTasks((current) =>
              current.map((candidate) =>
                candidate.id === editingTask.id
                  ? { ...candidate, subtask_done: done, subtask_total: total }
                  : candidate,
              ),
            )
          }
```

In `src/components/list/project-task-list.tsx`, add the same `onSubtaskCountsChange` prop to its `TaskDetailDrawer` element. Keep the same body, using `task` as the map variable name as that file does.

In `src/components/list/task-table.tsx`, add `import { SubtaskProgress } from "@/components/tasks/subtask-progress";`. Inside the title cell's `<div className="mt-1 flex flex-wrap gap-1">`, before the labels map, add `<SubtaskProgress done={task.subtask_done ?? 0} total={task.subtask_total ?? 0} />`.

- [ ] **Step 6: Run the tests and checks**

Run: `npm test`, then `npm run typecheck`, then `npm run lint`
Expected: the whole unit suite passes, including the 4 new tests. Typecheck and lint are clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tasks/subtask-counts.ts src/lib/tasks/subtask-counts.test.ts src/components/tasks/subtask-progress.tsx src/components/tasks/subtask-progress.test.tsx src/components/board/project-board.tsx src/components/board/task-detail-drawer.tsx src/components/board/task-detail-drawer.test.tsx src/components/list/task-table.tsx src/components/list/project-task-list.tsx "src/app/(app)/p/[projectId]/board/page.tsx" "src/app/(app)/p/[projectId]/list/page.tsx"
git commit -m "feat(tasks): show subtask progress on board cards and list rows"
```

---

## Plan-level rulings (made while writing this plan)

- **Reschedule transport.** The spec says "`update_task` with `{due_date, version}`". `update_task` needs the full payload, and there is no `version` column; concurrency uses `updated_at`. Ruling: the calendar sends the full payload plus `expectedUpdatedAt`, exactly as the List view's inline edit does. The RPC therefore returns `description` and `updated_at`. Cost if wrong: one extra column in the RPC.
- **Opening a task.** The spec says "clicking a chip opens the existing TaskDetailDrawer". The drawer needs the board's full context (columns, peers, labels). Ruling: chips link to `/p/{projectId}/board?task={id}`, which opens that same drawer on the board. This is the deep link that notifications and the Timeline already use. Cost if wrong: an in-place drawer can be added later without schema changes.
- **`can_edit` column.** This column was added to the RPC so the cross-project My Tasks calendar can disable dragging per task, since the viewer role varies by project. Cost if wrong: none.

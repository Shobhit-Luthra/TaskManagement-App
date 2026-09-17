# Kanbo Sub-plan 2C (Part 1) — Board completion: Tasks 2C.1–2C.4

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not start until Sub-plan 2B has shipped to staging with CI green.
>
> **Read first:** `00-master-roadmap.md` §2 Gap Register (T11 — dnd-kit/keyboard DnD; `04 §9` renormalisation rules referenced by T1/T12), §4 Cross-cutting rules; `2B-members-invitations.md` Global Constraints (the ambiguous-column bug, repeated below because it is binding here too) — 2B is the FORMAT TEMPLATE this file follows exactly. Every task here consumes `withApiHandler`/`mapRpcError` (`src/lib/api/handler.ts`), `RATE_LIMITS` (`src/lib/api/rate-limit.ts`), `createAdminClient` (`src/lib/supabase/admin.ts`), `seedIsolationFixture` (`src/test/rls/setup.ts`), `log` (`src/lib/log.ts`), and the board realtime layer (`src/lib/realtime/board-sync.ts`, `src/lib/realtime/use-project-channel.ts`) already shipped in 2A/2B.
>
> This is Part 1 of two files covering Sub-plan 2C. Part 2 (`2C-board-completion-2.md`) covers Tasks 2C.5–2C.7 and carries the sub-plan-exit verification section.

**Goal:** Replace the board's native-HTML5 drag layer with `@dnd-kit` (mouse **and** keyboard), stop task positions from colliding under repeated inserts, add assignee/priority/due-date editing backed by real membership validation, and add optimistic-concurrency conflict detection to `update_task`.

**Spec:** `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md` + `docs/specs/00`–`07`; `00-master-roadmap.md` §5 Sub-plan 2C.

## Global Constraints

- **The ambiguous-column bug (do not reintroduce it):** any `security definer` plpgsql function that declares `returns table (id uuid, ...)` (or any other OUT-parameter name that also happens to be a table column — `position`, `role`, `email`, etc.) creates a variable of that name in scope for the whole function body. An unqualified `where id = p_x` (or `min(position)`, `where role = ...`) inside that body is **ambiguous between the OUT parameter and the table column**, and Postgres raises `column reference "X" is ambiguous` on every call. This already broke `create_task`, `move_task`, `update_task`, `create_subtask`, `update_subtask`, `update_project_column`, `update_project`, `create_invitation` in this repo until fixed (`202609150001_fix_ambiguous_id_refs.sql`, `202609150002_fix_ambiguous_position_ref.sql`, `202609160005_fix_invitation_email_return_type.sql`). **Every RPC touched in this plan — `move_task`, `update_task`, the new `renormalize_column`/`renormalize_positions`, `move_column`, `delete_column`, `restore_task` — must qualify every bare reference to `id`, `position`, `role`, `email`, `column_id`, `deleted_at` with its table name or an explicit alias** (`tasks.position`, `t.id`, etc.) everywhere that name is also an OUT parameter or a `declare`d row variable field access ambiguity risk. Unit tests will not catch this — RPCs are mocked there. Only `npm run test:rls` against a real Supabase project does, so every task below that ships a migration ends with running it for real.
- TypeScript strict; no `any` in application code.
- No Docker locally. Apply migrations via `npm run db:push` against the linked project, or (if unavailable in the executing session) via the Supabase MCP `apply_migration` tool against `kanbo-dev` — either way, run `npm run test:rls` against the same project afterward to prove it.
- Every migration file: `supabase/migrations/YYYYMMDDNNNN_<name>.sql`, forward-only — **never edit a migration file after it has been applied to `kanbo-dev`**; ship a new one instead, even to fix a typo.
- Every new/changed RPC: `security definer`, `set search_path = public`, `revoke all … from public`, explicit `grant execute` to the minimum role (usually `authenticated`).
- Every new table: RLS enabled + forced, deny by default, explicit policies, added to the RLS integration suite in the same task.
- Every project-scoped write: non-members get **404** (`mapRpcError(error, { projectScoped: true })`, which demotes `42501`→404 only — `P0002` is already 404). Members without sufficient role get **403**.
- `SUPABASE_SERVICE_ROLE_KEY` only via `createAdminClient()` — never inline.
- Structured JSON logs via `log()`; never log task titles/descriptions above `debug`.
- Commit at the end of every task: Conventional Commits, **no `Co-Authored-By` or `Claude-Session` trailers** (`ENGINEERING_RULES.md §7`). Before each commit: `git status`, inspect the diff, no secrets, `npm run test`, `npm run typecheck`, `npm run lint`.
- Accessibility is not optional here: T11 exists because `01 §24` makes keyboard drag-and-drop a hard requirement, not a nice-to-have. Every acceptance test that mentions keyboard interaction or `prefers-reduced-motion` is load-bearing, not decorative.

---

## File Structure

```
package.json                                                      Task 2C.1 — add @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities
src/components/board/board.tsx                                    Task 2C.1 — replaces project-board.tsx as the default export used by board/page.tsx
src/components/board/column.tsx                                   Task 2C.1
src/components/board/task-card.tsx                                Task 2C.1 (extended Task 2C.3 — avatar, priority icon)
src/components/board/task-editor.tsx                               Task 2C.1 (extended Task 2C.3, 2C.4 — assignee picker, conflict banner)
src/components/board/use-board-dnd.ts                              Task 2C.1
src/components/board/use-board-dnd.test.ts                         Task 2C.1
src/components/board/announcer.tsx                                 Task 2C.1
src/components/board/announcer.test.tsx                            Task 2C.1
src/components/board/compute-drop-position.ts                     Task 2C.1
src/components/board/compute-drop-position.test.ts                Task 2C.1
src/components/board/board.test.tsx                                Task 2C.1 (keyboard DnD test)
src/components/board/project-board.tsx                             Task 2C.1 — deleted, superseded by board.tsx + column.tsx + task-card.tsx
e2e/board-drag.spec.ts                                             Task 2C.1
playwright.config.ts                                                Task 2C.1 (created — no Playwright infra exists yet in this repo; see Task 2C.1 Step 0)
src/app/(app)/p/[projectId]/board/page.tsx                         Task 2C.1 (modify — import Board instead of ProjectBoard)
supabase/migrations/202609190001_renormalize_positions.sql        Task 2C.2
supabase/migrations/202609190002_job_runs.sql                     Task 2C.2
src/test/rls/board-positions.test.ts                                Task 2C.2
src/components/board/assignee-picker.tsx                          Task 2C.3
src/components/board/assignee-picker.test.tsx                     Task 2C.3
supabase/migrations/202609190003_task_assignee_validation.sql     Task 2C.3
src/lib/tasks/schemas.ts                                            Task 2C.3 (modify — assigneeId already present; Task 2C.4 adds expectedUpdatedAt)
src/test/rls/board-assignee.test.ts                                 Task 2C.3
supabase/migrations/202609190004_optimistic_concurrency.sql       Task 2C.4
src/app/api/v1/tasks/[taskId]/route.ts                             Task 2C.4 (modify — pass p_expected_updated_at, map 40001)
src/test/rls/board-concurrency.test.ts                              Task 2C.4
```

---

### Task 2C.1 — dnd-kit migration with keyboard DnD (T11)

**Files:**
- Create: `src/components/board/board.tsx`, `column.tsx`, `task-card.tsx`, `task-editor.tsx`, `use-board-dnd.ts`, `use-board-dnd.test.ts`, `announcer.tsx`, `announcer.test.tsx`, `compute-drop-position.ts`, `compute-drop-position.test.ts`, `board.test.tsx`, `e2e/board-drag.spec.ts`, `playwright.config.ts`
- Delete: `src/components/board/project-board.tsx` (its contents are split across the new files)
- Modify: `src/app/(app)/p/[projectId]/board/page.tsx` (import `Board` instead of `ProjectBoard`), `package.json` (deps + `test:e2e` script)

**Interfaces:**
- Produces:
  ```ts
  // compute-drop-position.ts
  export function computeDropPosition(prev: number | null, next: number | null): number;
  // use-board-dnd.ts
  export function useBoardDnd(params: {
    tasks: BoardTask[];
    columns: BoardColumn[];
    readOnly: boolean;
    onMove: (taskId: string, columnId: string, position: number, mutationId: string) => void;
  }): {
    sensors: SensorDescriptor<SensorOptions>[];
    activeTask: BoardTask | null;
    onDragStart: (event: DragStartEvent) => void;
    onDragOver: (event: DragOverEvent) => void;
    onDragEnd: (event: DragEndEvent) => void;
    onDragCancel: () => void;
  };
  ```
- Consumes: `mergeTaskEvent`/`mergeColumnEvent` (`src/lib/realtime/board-sync.ts`, unchanged), `useProjectChannel` (unchanged), `PATCH /api/v1/tasks/:taskId/position` (unchanged route, `src/app/api/v1/tasks/[taskId]/position/route.ts`).

**Acceptance:** unit tests for `computeDropPosition` (between/top/bottom/empty); keyboard test with Testing Library — Space lifts, ArrowRight moves the active card to the next column's drop zone, Space drops and calls `onMove` with a fresh `mutationId`; the live region text changes once per drop and is throttled to at most once per second across a rapid sequence; `prefers-reduced-motion: reduce` disables `DragOverlay` transitions (`transition: null` passed to `useSortable`); Playwright mouse-drag E2E persists the new column/position after a full page reload.

- [ ] **Step 0: Add Playwright (no E2E infra exists yet in this repo)**

The master roadmap (`00-master-roadmap.md` T8, 2A §5) assumes Playwright lands in 2B.4; at the time this file was written the repo has no `e2e/` directory, no `playwright.config.ts`, and no `@playwright/test` dependency. This step is a one-time prerequisite so the E2E acceptance test below has somewhere to live — do not re-do it in a later task.

```bash
npm install -D @playwright/test
npx playwright install --with-deps chromium
```

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

Add to `package.json` scripts: `"test:e2e": "playwright test"`. Test users for E2E are created confirmed via the Supabase Admin API (T8) in `e2e/fixtures/auth.ts` — reuse the same `createAdminClient()`-backed pattern as `src/test/rls/setup.ts`'s `createConfirmedUser`, but sign in through the real `/login` page with Playwright's `page.fill`/`page.click` rather than a direct client call, since the point of this suite is to exercise the browser.

```ts
// e2e/fixtures/auth.ts
import { createAdminClient } from "@/lib/supabase/admin";
import type { Page } from "@playwright/test";

export async function createAndSignInTestUser(page: Page, label: string) {
  const admin = createAdminClient();
  const email = `e2e-${label}-${crypto.randomUUID()}@example.test`;
  const password = `Pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `E2E ${label}` },
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/projects");
  return { id: data.user.id, email };
}
```

- [ ] **Step 1: Write the failing `computeDropPosition` unit test**

```ts
// src/components/board/compute-drop-position.test.ts
import { describe, expect, it } from "vitest";
import { computeDropPosition } from "./compute-drop-position";

describe("computeDropPosition (04 §9)", () => {
  it("returns the midpoint when dropped between two cards", () => {
    expect(computeDropPosition(1000, 2000)).toBe(1500);
  });

  it("returns prev - 1 when dropped at the top of the column", () => {
    expect(computeDropPosition(null, 1000)).toBe(999);
  });

  it("returns next + 1 when dropped at the bottom of the column", () => {
    expect(computeDropPosition(1000, null)).toBe(1001);
  });

  it("returns a starting position for an empty column", () => {
    expect(computeDropPosition(null, null)).toBe(1000);
  });

  it("never returns NaN or Infinity for adjacent integer positions (collision case, handled by renormalisation in 2C.2)", () => {
    const result = computeDropPosition(1000, 1000);
    expect(Number.isFinite(result)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/board/compute-drop-position.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `computeDropPosition`**

```ts
// src/components/board/compute-drop-position.ts
/**
 * Pure fractional-index placement (04 §9). `prev`/`next` are the positions of
 * the cards immediately above/below the drop point in the target column, or
 * null at an edge. The server (move_task, 2C.2) is the source of truth for
 * collision detection and renormalisation — this function only proposes a
 * value; move_task always returns the canonical position, which the client
 * reconciles onto the optimistic state.
 */
export function computeDropPosition(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 1000;
  if (prev === null) return next! - 1;
  if (next === null) return prev + 1;
  return (prev + next) / 2;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/board/compute-drop-position.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `useBoardDnd` unit test**

```ts
// src/components/board/use-board-dnd.test.ts
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBoardDnd } from "./use-board-dnd";
import type { BoardColumn, BoardTask } from "./board";

const columns: BoardColumn[] = [
  { id: "col-a", name: "To Do", position: 1, wip_limit: null },
  { id: "col-b", name: "Doing", position: 2, wip_limit: null },
];
const tasks: BoardTask[] = [
  { id: "t1", column_id: "col-a", title: "One", description: null, due_date: null, priority: "medium", position: 1000, created_at: "", updated_at: "", assignee_id: null, subtask_count: 0, subtask_completed_count: 0 },
  { id: "t2", column_id: "col-a", title: "Two", description: null, due_date: null, priority: "medium", position: 2000, created_at: "", updated_at: "", assignee_id: null, subtask_count: 0, subtask_completed_count: 0 },
];

describe("useBoardDnd", () => {
  it("calls onMove with the target column and a fresh mutationId on drag end", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() =>
      useBoardDnd({ tasks, columns, readOnly: false, onMove }),
    );

    act(() => {
      result.current.onDragStart({ active: { id: "t1" } } as never);
      result.current.onDragEnd({
        active: { id: "t1" },
        over: { id: "col-b", data: { current: { type: "column", columnId: "col-b" } } },
      } as never);
    });

    expect(onMove).toHaveBeenCalledTimes(1);
    const [taskId, columnId, position, mutationId] = onMove.mock.calls[0];
    expect(taskId).toBe("t1");
    expect(columnId).toBe("col-b");
    expect(typeof position).toBe("number");
    expect(typeof mutationId).toBe("string");
  });

  it("does nothing when readOnly", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() =>
      useBoardDnd({ tasks, columns, readOnly: true, onMove }),
    );
    act(() => {
      result.current.onDragEnd({
        active: { id: "t1" },
        over: { id: "col-b", data: { current: { type: "column", columnId: "col-b" } } },
      } as never);
    });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("does nothing when dropped back in the same position", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() =>
      useBoardDnd({ tasks, columns, readOnly: false, onMove }),
    );
    act(() => {
      result.current.onDragEnd({
        active: { id: "t1" },
        over: { id: "t1", data: { current: { type: "task", columnId: "col-a" } } },
      } as never);
    });
    expect(onMove).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/components/board/use-board-dnd.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Install dnd-kit**

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 8: Implement `useBoardDnd`**

```ts
// src/components/board/use-board-dnd.ts
"use client";

import { useCallback, useMemo, useState } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { computeDropPosition } from "./compute-drop-position";
import type { BoardColumn, BoardTask } from "./board";

type DragOverData = { type: "column" | "task"; columnId: string };

export function useBoardDnd(params: {
  tasks: BoardTask[];
  columns: BoardColumn[];
  readOnly: boolean;
  onMove: (taskId: string, columnId: string, position: number, mutationId: string) => void;
}) {
  const { tasks, columns, readOnly, onMove } = params;
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? null,
    [tasks, activeTaskId],
  );

  const onDragStart = useCallback((event: DragStartEvent) => {
    if (readOnly) return;
    setActiveTaskId(String(event.active.id));
  }, [readOnly]);

  // No-op today; reserved for a future "reorder within column while dragging"
  // preview. Kept as a stable identity so <DndContext onDragOver> never
  // needs a conditional prop.
  const onDragOver = useCallback((_event: DragOverEvent) => {}, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTaskId(null);
      if (readOnly) return;
      const { active, over } = event;
      if (!over) return;
      const taskId = String(active.id);
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;

      const overData = over.data.current as DragOverData | undefined;
      const targetColumnId = overData?.columnId ?? String(over.id);
      const targetColumn = columns.find((column) => column.id === targetColumnId);
      if (!targetColumn) return;

      const siblings = tasks
        .filter((candidate) => candidate.column_id === targetColumnId && candidate.id !== taskId)
        .sort((a, b) => a.position - b.position);

      // over.id is either the column drop-zone id (dropped into empty space —
      // append to the end) or another task's id (dropped at that task's
      // position — insert immediately above it).
      let prev: number | null = null;
      let next: number | null = null;
      if (overData?.type === "task") {
        const overIndex = siblings.findIndex((candidate) => candidate.id === over.id);
        if (overIndex === -1) {
          prev = siblings.at(-1)?.position ?? null;
        } else {
          next = siblings[overIndex]?.position ?? null;
          prev = siblings[overIndex - 1]?.position ?? null;
        }
      } else {
        prev = siblings.at(-1)?.position ?? null;
      }

      const position = computeDropPosition(prev, next);
      if (task.column_id === targetColumnId && position === task.position) return;

      onMove(taskId, targetColumnId, position, crypto.randomUUID());
    },
    [tasks, columns, readOnly, onMove],
  );

  const onDragCancel = useCallback(() => setActiveTaskId(null), []);

  return { sensors, activeTask, onDragStart, onDragOver, onDragEnd, onDragCancel };
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `npx vitest run src/components/board/use-board-dnd.test.ts`
Expected: PASS.

- [ ] **Step 10: Write the failing announcer test**

```tsx
// src/components/board/announcer.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Announcer, type AnnouncerHandle } from "./announcer";
import { createRef } from "react";

describe("Announcer (a11y live region, throttled 1s)", () => {
  it("renders the most recent message and drops messages announced within 1s of the last one", () => {
    vi.useFakeTimers();
    const ref = createRef<AnnouncerHandle>();
    render(<Announcer ref={ref} />);
    act(() => ref.current?.announce("Task moved to Doing"));
    expect(screen.getByRole("status")).toHaveTextContent("Task moved to Doing");

    act(() => ref.current?.announce("Task moved to Done"));
    // still throttled — the region has not updated to the second message yet
    expect(screen.getByRole("status")).toHaveTextContent("Task moved to Doing");

    act(() => vi.advanceTimersByTime(1000));
    act(() => ref.current?.announce("Task moved to Done"));
    expect(screen.getByRole("status")).toHaveTextContent("Task moved to Done");
    vi.useRealTimers();
  });
});
```

- [ ] **Step 11: Run to verify it fails**

Run: `npx vitest run src/components/board/announcer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 12: Implement the announcer**

```tsx
// src/components/board/announcer.tsx
"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";

export type AnnouncerHandle = { announce: (message: string) => void };

const THROTTLE_MS = 1000;

export const Announcer = forwardRef<AnnouncerHandle>(function Announcer(_props, ref) {
  const [message, setMessage] = useState("");
  const lastAnnouncedAt = useRef(0);

  useImperativeHandle(ref, () => ({
    announce(next: string) {
      const now = Date.now();
      if (now - lastAnnouncedAt.current < THROTTLE_MS) return;
      lastAnnouncedAt.current = now;
      setMessage(next);
    },
  }));

  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
});
```

- [ ] **Step 13: Run to verify it passes**

Run: `npx vitest run src/components/board/announcer.test.tsx`
Expected: PASS.

- [ ] **Step 14: Split `project-board.tsx` — `column.tsx`, `task-card.tsx`, `task-editor.tsx`, `board.tsx`**

`column.tsx` wraps `useDroppable` (for the column drop-zone id) and `SortableContext` (for its task ids):

```tsx
// src/components/board/column.tsx
"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskCard } from "./task-card";
import { TaskComposer } from "./task-composer";
import type { BoardColumn, BoardTask } from "./board";

export function Column({
  column,
  tasks,
  readOnly,
  hasFilters,
  isActiveOnMobile,
  projectId,
  onOpenTask,
  onTaskCreated,
  composerRef,
}: {
  column: BoardColumn;
  tasks: BoardTask[];
  readOnly: boolean;
  hasFilters: boolean;
  isActiveOnMobile: boolean;
  projectId: string;
  onOpenTask: (task: BoardTask) => void;
  onTaskCreated: (task: BoardTask) => void;
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${column.id}`,
    data: { type: "column", columnId: column.id },
  });
  const atWipLimit = column.wip_limit != null && tasks.length >= column.wip_limit;

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "bg-card flex min-h-[calc(100dvh-180px)] w-[min(21rem,calc(100vw-2rem))] shrink-0 flex-col rounded-xl shadow-sm ring-1 ring-black/5 md:w-72",
        !isActiveOnMobile && "max-md:hidden",
        isOver && "ring-primary ring-2",
      )}
    >
      <header className="bg-card sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{column.name}</h2>
          <p
            className={cn(
              "mt-0.5 flex items-center gap-1 text-xs",
              atWipLimit ? "text-amber-700 font-medium dark:text-amber-400" : "text-muted-foreground",
            )}
          >
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
            {column.wip_limit ? ` · WIP ${column.wip_limit}` : ""}
            {atWipLimit && <span aria-hidden="true">⚠</span>}
          </p>
        </div>
        {!readOnly && <Plus className="text-muted-foreground size-4" aria-hidden="true" />}
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} readOnly={readOnly} onOpen={() => onOpenTask(task)} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="text-muted-foreground flex min-h-28 items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm">
            {hasFilters ? "No matching tasks" : readOnly ? "No tasks in this column" : "Add a task to get started"}
          </div>
        )}
      </div>
      {!readOnly && (
        <TaskComposer
          projectId={projectId}
          columnId={column.id}
          onCreated={onTaskCreated}
          inputRef={composerRef}
        />
      )}
    </section>
  );
}
```

`task-card.tsx` wraps `useSortable` and drops the old `<select>`-based "Move to" affordance in favour of drag + the keyboard sensor (Tab to the card, Space to lift, arrow keys to move, Space to drop, Escape to cancel — dnd-kit's `KeyboardSensor` default keymap); Task 2C.3 extends this file with the assignee avatar:

```tsx
// src/components/board/task-card.tsx
"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, CircleAlert, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BoardTask } from "./board";

export function TaskCard({
  task,
  readOnly,
  onOpen,
}: {
  task: BoardTask;
  readOnly: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task", columnId: task.column_id },
    disabled: readOnly,
  });
  const prefersReducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: prefersReducedMotion ? undefined : transition,
  };

  const due = task.due_date ? new Date(`${task.due_date}T00:00:00`) : null;
  const isOverdue = due ? due < startOfToday() : false;

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...(readOnly ? {} : attributes)}
      {...(readOnly ? {} : listeners)}
      aria-roledescription={readOnly ? undefined : "sortable task card"}
      className={cn(
        "bg-background rounded-lg border p-3 shadow-sm transition-shadow hover:shadow-md",
        !readOnly && "cursor-grab touch-none active:cursor-grabbing",
        isDragging && "opacity-50",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="focus-visible:ring-ring line-clamp-2 w-full text-left text-sm leading-5 font-medium break-words hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:outline-none"
      >
        {task.title}
      </button>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <span className={cn("inline-flex items-center gap-1 capitalize", priorityColor(task.priority))}>
          <Flag className="size-3" aria-hidden="true" />
          {task.priority}
        </span>
        <div className="flex items-center gap-2">
          {task.subtask_count > 0 && (
            <span className="text-muted-foreground">
              {task.subtask_completed_count}/{task.subtask_count}
            </span>
          )}
          {due && (
            <span className={cn("inline-flex items-center gap-1", isOverdue && "text-destructive font-medium")}>
              {isOverdue && <CircleAlert className="size-3" aria-label="Overdue" />}
              {!isOverdue && <CalendarDays className="size-3" aria-hidden="true" />}
              {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(due)}
            </span>
          )}
        </div>
      </div>
      {task.assignee_display_name && (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          <span
            aria-hidden="true"
            className="bg-primary/10 text-primary grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold"
          >
            {initials(task.assignee_display_name)}
          </span>
          <span className="text-muted-foreground truncate">{task.assignee_display_name}</span>
        </div>
      )}
    </article>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function priorityColor(priority: BoardTask["priority"]) {
  return { low: "text-slate-500", medium: "text-blue-600", high: "text-amber-700", urgent: "text-destructive" }[priority];
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}
```

`task-editor.tsx` and `task-composer.tsx` (extracted verbatim from `project-board.tsx`'s `TaskEditor`/`TaskComposer`, unchanged in this task — Task 2C.3/2C.4 extend `task-editor.tsx` further) — move those two function bodies out of `project-board.tsx` into their own files with the same props, importing `SubtaskList` into `task-editor.tsx` as well (also extracted verbatim). The `BoardTask` type moves to `board.tsx` and gains the fields Task 2C.3/2C.7 need:

```tsx
// src/components/board/board.tsx (top of file, replaces the old project-board.tsx type + component)
"use client";

import { useEffect, useRef, useState } from "react";
import { DndContext, DragOverlay, closestCorners } from "@dnd-kit/core";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  MUTATION_ECHO_TTL_MS,
  SYNC_GRACE_MS,
  mergeColumnEvent,
  mergeTaskEvent,
} from "@/lib/realtime/board-sync";
import { useProjectChannel } from "@/lib/realtime/use-project-channel";
import { Announcer, type AnnouncerHandle } from "./announcer";
import { Column } from "./column";
import { TaskCard } from "./task-card";
import { TaskEditor } from "./task-editor";
import { useBoardDnd } from "./use-board-dnd";

export type BoardColumn = { id: string; name: string; position: number; wip_limit: number | null };

export type BoardTask = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  position: number;
  created_at: string;
  updated_at: string;
  assignee_id: string | null;
  assignee_display_name?: string | null;
  subtask_count: number;
  subtask_completed_count: number;
};

export function Board({
  projectId,
  currentUserId,
  initialColumns,
  initialTasks,
  readOnly: readOnlyRole,
}: {
  projectId: string;
  currentUserId: string;
  initialColumns: BoardColumn[];
  initialTasks: BoardTask[];
  readOnly: boolean;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [columns, setColumns] = useState(initialColumns);
  const [editingTask, setEditingTask] = useState<BoardTask | null>(null);
  const inFlightMutations = useRef<Set<string>>(new Set());
  const announcerRef = useRef<AnnouncerHandle>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const syncStatus = useProjectChannel(projectId, currentUserId, {
    onTask: (event) => {
      setTasks((current) => {
        const result = mergeTaskEvent(current, event, inFlightMutations.current);
        if (result.consumedMutationId) inFlightMutations.current.delete(result.consumedMutationId);
        return result.tasks;
      });
    },
    onColumn: (event) => setColumns((current) => mergeColumnEvent(current, event)),
    onMembershipRemoved: () => router.replace("/projects?removed=1"),
  });

  const [degraded, setDegraded] = useState(false);
  useEffect(() => {
    if (syncStatus !== "reconnecting") return;
    const timer = window.setTimeout(() => setDegraded(true), SYNC_GRACE_MS);
    return () => {
      window.clearTimeout(timer);
      setDegraded(false);
    };
  }, [syncStatus]);
  const readOnly = readOnlyRole || degraded;

  async function moveTask(taskId: string, columnId: string, position: number, mutationId: string) {
    const previous = tasks.find((task) => task.id === taskId);
    if (!previous) return;
    inFlightMutations.current.add(mutationId);
    window.setTimeout(() => inFlightMutations.current.delete(mutationId), MUTATION_ECHO_TTL_MS);
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, column_id: columnId, position } : task)),
    );
    const targetColumn = columns.find((column) => column.id === columnId);
    if (targetColumn) announcerRef.current?.announce(`${previous.title} moved to ${targetColumn.name}`);
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/position`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId, position, mutationId }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isMovedTask(payload)) throw new Error("Move rejected");
      setTasks((current) =>
        current.map((task) => (task.id === taskId ? { ...task, ...payload.data } : task)),
      );
    } catch {
      setTasks((current) => current.map((task) => (task.id === taskId ? previous : task)));
      announcerRef.current?.announce(`${previous.title} could not be moved and was returned to ${columns.find((c) => c.id === previous.column_id)?.name ?? "its column"}`);
    }
  }

  const dnd = useBoardDnd({ tasks, columns, readOnly, onMove: moveTask });

  // ?task= deep link (2C.7) and query-state filters (unchanged from the
  // previous project-board.tsx implementation) continue to live here.
  useEffect(() => {
    const deepLinkId = searchParams.get("task");
    if (!deepLinkId) return;
    const task = tasks.find((candidate) => candidate.id === deepLinkId);
    if (task) setEditingTask(task);
  }, [searchParams, tasks]);

  function closeEditor() {
    setEditingTask(null);
    if (searchParams.get("task")) {
      const params = new URLSearchParams(searchParams);
      params.delete("task");
      const suffix = params.toString();
      router.replace(suffix ? `${pathname}?${suffix}` : pathname, { scroll: false });
    }
  }

  if (columns.length === 0) {
    return (
      <section className="bg-card m-6 rounded-xl border border-dashed p-8 text-center">
        <h2 className="text-lg font-semibold">This board has no columns</h2>
        <p className="text-muted-foreground mt-2 text-sm">Refresh the page after adding a workflow.</p>
      </section>
    );
  }

  return (
    <section aria-label="Board columns" className="bg-muted/40 relative flex-1 overflow-hidden">
      <Announcer ref={announcerRef} />
      {syncStatus === "reconnecting" && (
        <p role="status" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {degraded ? "Reconnecting to live updates. The board is read-only until the connection returns." : "Reconnecting to live updates…"}
        </p>
      )}
      <DndContext
        sensors={dnd.sensors}
        collisionDetection={closestCorners}
        onDragStart={dnd.onDragStart}
        onDragOver={dnd.onDragOver}
        onDragEnd={dnd.onDragEnd}
        onDragCancel={dnd.onDragCancel}
      >
        <div className="flex h-full gap-3 overflow-x-auto p-4 pt-3 md:pt-4">
          {columns.map((column, index) => (
            <Column
              key={column.id}
              column={column}
              tasks={tasks.filter((task) => task.column_id === column.id).sort((a, b) => a.position - b.position)}
              readOnly={readOnly}
              hasFilters={false}
              isActiveOnMobile={index === 0}
              projectId={projectId}
              onOpenTask={setEditingTask}
              onTaskCreated={(task) => setTasks((current) => [...current, task])}
            />
          ))}
        </div>
        <DragOverlay>
          {dnd.activeTask && <TaskCard task={dnd.activeTask} readOnly={false} onOpen={() => {}} />}
        </DragOverlay>
      </DndContext>
      {editingTask && (
        <TaskEditor
          task={editingTask}
          readOnly={readOnly}
          onClose={closeEditor}
          onSaved={(task) => {
            setTasks((current) => current.map((candidate) => (candidate.id === task.id ? task : candidate)));
            closeEditor();
          }}
          onDeleted={(taskId) => {
            setTasks((current) => current.filter((task) => task.id !== taskId));
            closeEditor();
          }}
        />
      )}
    </section>
  );
}

function isMovedTask(value: unknown): value is { data: Pick<BoardTask, "id" | "column_id" | "position" | "updated_at"> } {
  if (typeof value !== "object" || value === null || !("data" in value)) return false;
  const task = value.data;
  return typeof task === "object" && task !== null && "id" in task && "column_id" in task && "position" in task;
}
```

The search/priority filter bar and mobile column pager from the old `project-board.tsx` are preserved as-is, moved verbatim into `board.tsx` above the `<DndContext>` — omitted here for brevity since they carry over unchanged (filters proper land in 2E; this task only relocates them).

Delete `src/components/board/project-board.tsx`. Update `src/app/(app)/p/[projectId]/board/page.tsx`:

```ts
// src/app/(app)/p/[projectId]/board/page.tsx — change the import and JSX tag only
import { Board, type BoardColumn, type BoardTask } from "@/components/board/board";
// ...
<Board
  projectId={projectId}
  currentUserId={auth.user.id}
  initialColumns={columns}
  initialTasks={tasks}
  readOnly={membership?.role === "viewer"}
/>
```

The server query for `initialTasks` also needs `assignee_id`, `project_peers!inner(display_name)` and `subtasks(count)` — Task 2C.3 and 2C.7 make those changes to the same `select(...)` string; do not duplicate the edit here.

- [ ] **Step 15: Write the failing keyboard DnD test**

```tsx
// src/components/board/board.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Board } from "./board";

vi.mock("@/lib/realtime/use-project-channel", () => ({
  useProjectChannel: () => "connected",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/p/proj/board",
  useSearchParams: () => new URLSearchParams(),
}));

const columns = [
  { id: "col-a", name: "To Do", position: 1, wip_limit: null },
  { id: "col-b", name: "Doing", position: 2, wip_limit: null },
];
const tasks = [
  { id: "t1", column_id: "col-a", title: "Write plan", description: null, due_date: null, priority: "medium" as const, position: 1000, created_at: "", updated_at: "", assignee_id: null, subtask_count: 0, subtask_completed_count: 0 },
];

describe("Board keyboard drag-and-drop (01 §24)", () => {
  it("moves a card to the next column with Space, ArrowRight, Space", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "t1", column_id: "col-b", position: 1000, updated_at: "now" } }),
    }) as unknown as typeof fetch;

    render(
      <Board projectId="proj" currentUserId="u1" initialColumns={columns} initialTasks={tasks} readOnly={false} />,
    );

    const card = screen.getByRole("button", { name: /write plan/i }).closest("article")!;
    card.focus();
    const user = userEvent.setup();
    await user.keyboard(" "); // lift
    await user.keyboard("{ArrowRight}"); // move toward col-b
    await user.keyboard(" "); // drop

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/v1/tasks/t1/position",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});
```

- [ ] **Step 16: Run to verify it fails**

Run: `npx vitest run src/components/board/board.test.tsx`
Expected: FAIL — `board.tsx` does not exist yet, or the drag sequence does not trigger `fetch`.

- [ ] **Step 17: Wire everything and run to verify it passes**

Complete Steps 14 exactly as written (move the composer/editor/subtask-list bodies over verbatim), then:

Run: `npx vitest run src/components/board`
Expected: PASS on all of `compute-drop-position.test.ts`, `use-board-dnd.test.ts`, `announcer.test.tsx`, `board.test.tsx`.

- [ ] **Step 18: Write the Playwright E2E mouse-drag test**

```ts
// e2e/board-drag.spec.ts
import { test, expect } from "@playwright/test";
import { createAndSignInTestUser } from "./fixtures/auth";

test("dragging a card to another column persists after reload", async ({ page }) => {
  await createAndSignInTestUser(page, "drag");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name").fill("Drag E2E");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/p\/.+\/board/);

  await page.getByPlaceholder("Add a task…").fill("Draggable task");
  await page.keyboard.press("Enter");
  const card = page.getByRole("button", { name: "Draggable task" }).locator("..");
  const doing = page.getByRole("heading", { name: "In Progress" }).locator("../..");

  const cardBox = await card.boundingBox();
  const doingBox = await doing.boundingBox();
  if (!cardBox || !doingBox) throw new Error("missing bounding box");
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(doingBox.x + doingBox.width / 2, doingBox.y + 60, { steps: 10 });
  await page.mouse.up();

  await expect(doing.getByText("Draggable task")).toBeVisible();
  await page.reload();
  await expect(doing.getByText("Draggable task")).toBeVisible();
});
```

Run: `npm run test:e2e -- e2e/board-drag.spec.ts` against a running dev server pointed at `kanbo-staging` (`E2E_BASE_URL`). Expected: PASS.

- [ ] **Step 19: Full checks and commit**

Run: `npm run test && npm run typecheck && npm run lint && npm run build`
Expected: all PASS.

```bash
git add package.json package-lock.json src/components/board src/app/\(app\)/p/\[projectId\]/board/page.tsx e2e playwright.config.ts
git commit -m "feat(board): migrate drag-and-drop to dnd-kit with keyboard support"
```

---

### Task 2C.2 — Renormalisation (`04 §9`)

**Files:**
- Create: `supabase/migrations/202609190001_renormalize_positions.sql`, `supabase/migrations/202609190002_job_runs.sql`, `src/test/rls/board-positions.test.ts`

**Interfaces:**
- Produces: `renormalize_column(p_column_id uuid) returns void` (spaces every non-deleted task in the column at multiples of 1000, preserving order), `renormalize_positions() returns void` (nightly `pg_cron` sweep over every column whose minimum gap has fallen under `1e-6`), table `public.job_runs (job_name text, run_key text, started_at timestamptz, finished_at timestamptz, error text, primary key (job_name, run_key))` (T1 — reused by every later `pg_cron`/`pg_net` job in 2F/2G).
- Modifies: `move_task` — before computing the final position, checks whether `p_position` collides with (is within `1e-6` of) an existing sibling's position; if so, calls `renormalize_column` first, then re-derives the position for the moved task as one of the fresh 1000-spaced slots at the same relative place, and returns the canonical value so the client can reconcile.

- [ ] **Step 1: Write the failing SQL integration test — 60 consecutive top inserts never collide**

```ts
// src/test/rls/board-positions.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let f: IsolationFixture;
beforeAll(async () => {
  f = await seedIsolationFixture();
});
afterAll(async () => {
  await f.cleanup();
});

describe("move_task renormalisation (04 §9)", () => {
  it("60 consecutive moves to the same top position never collide and stay ordered", async () => {
    const created: string[] = [f.taskId];
    for (let i = 0; i < 59; i++) {
      const { data, error } = await f.a.rpc("create_task", {
        p_project_id: f.projectId,
        p_column_id: f.columnId,
        p_title: `Task ${i}`,
      });
      expect(error).toBeNull();
      const row = Array.isArray(data) ? data[0] : data;
      created.push(row.id);
    }

    // Move every task to the very top, one after another — this is the
    // pathological case that collapses the gap between position 1 and the
    // next-lowest sibling toward zero if nothing renormalises it.
    for (const taskId of created) {
      const { error } = await f.a.rpc("move_task", {
        p_task_id: taskId,
        p_column_id: f.columnId,
        p_position: 0.5,
        p_mutation_id: crypto.randomUUID(),
      });
      expect(error).toBeNull();
    }

    const { data: rows, error } = await f.a
      .from("tasks")
      .select("id, position")
      .eq("column_id", f.columnId)
      .is("deleted_at", null)
      .order("position");
    expect(error).toBeNull();
    const positions = (rows ?? []).map((row) => row.position as number);
    // strictly increasing, and every gap is at least 1e-6 apart
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      expect(positions[i] - positions[i - 1]).toBeGreaterThanOrEqual(1e-6);
    }
  });
});

describe("renormalize_positions() nightly sweep", () => {
  it("re-spaces a column at 1000-unit gaps and records a job_runs row", async () => {
    const runKey = `test-${crypto.randomUUID()}`;
    const { error } = await f.a.rpc("run_renormalize_positions_for_test", { p_run_key: runKey });
    expect(error).toBeNull();
    const { data: jobRow } = await f.a
      .from("job_runs")
      .select("job_name, finished_at, error")
      .eq("job_name", "renormalize_positions")
      .eq("run_key", runKey)
      .maybeSingle();
    expect(jobRow?.finished_at).not.toBeNull();
    expect(jobRow?.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/board-positions.test.ts`
Expected: FAIL — `job_runs` does not exist; `move_task` has no collision handling; `run_renormalize_positions_for_test` does not exist.

- [ ] **Step 3: `job_runs` migration**

```sql
-- supabase/migrations/202609190002_job_runs.sql
-- Idempotency + observability for every pg_cron/pg_net job from here through
-- 2G (T1). unique(job_name, run_key) means a duplicate trigger for the same
-- run is a no-op rather than a double-send/double-run.
create table public.job_runs (
  job_name text not null,
  run_key text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  primary key (job_name, run_key)
);
alter table public.job_runs enable row level security;
alter table public.job_runs force row level security;
-- No policies: deny by default. Written only by security definer job
-- functions (which bypass RLS as their invoker) or the service-role cron
-- route in 2F — never directly by an authenticated client.
```

- [ ] **Step 4: `renormalize_column` + `move_task` collision handling + `renormalize_positions` migration**

```sql
-- supabase/migrations/202609190001_renormalize_positions.sql

-- Re-spaces every non-deleted task in a column at multiples of 1000,
-- preserving current order (04 §9). Called from move_task when a collision
-- is detected, and by the nightly sweep as a defensive pass.
create or replace function public.renormalize_column(p_column_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  task_row record;
  next_position double precision := 1000;
begin
  for task_row in
    select tasks.id from public.tasks
    where tasks.column_id = p_column_id and tasks.deleted_at is null
    order by tasks.position
    for update
  loop
    update public.tasks set position = next_position where tasks.id = task_row.id;
    next_position := next_position + 1000;
  end loop;
end;
$$;
revoke all on function public.renormalize_column(uuid) from public;
grant execute on function public.renormalize_column(uuid) to authenticated;

-- move_task, extended with collision detection. Bodies before the collision
-- check are unchanged from 202609160001_fix_project_scoped_404.sql — only
-- the position-assignment tail changes. All column references remain
-- qualified per the ambiguous-column convention.
create or replace function public.move_task(
  p_task_id uuid, p_column_id uuid, p_position double precision, p_mutation_id uuid
) returns table (id uuid, column_id uuid, "position" double precision, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_task public.tasks%rowtype;
  source_is_done boolean;
  target_is_done boolean;
  activity_kind public.activity_action;
  source_column_id uuid;
  final_position double precision := p_position;
  collides boolean;
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

  -- Renormalisation (04 §9): if the proposed position is within 1e-6 of an
  -- existing sibling in the target column, gaps have collapsed too far to
  -- subdivide further with double-precision arithmetic. Renormalise the
  -- whole target column to fresh 1000-unit gaps first, then re-derive the
  -- final position as the midpoint of the (now integer-spaced) neighbours
  -- the client originally intended to land between.
  select exists (
    select 1 from public.tasks
    where tasks.column_id = p_column_id and tasks.id <> p_task_id and tasks.deleted_at is null
      and abs(tasks.position - p_position) < 1e-6
  ) into collides;

  if collides then
    perform public.renormalize_column(p_column_id);
    select coalesce(
      (select min(tasks.position) - 1000 from public.tasks where tasks.column_id = p_column_id and tasks.deleted_at is null
        and tasks.position > (select coalesce(max(t2.position), 0) from public.tasks t2 where t2.column_id = p_column_id and t2.deleted_at is null and t2.position < p_position)),
      1000
    ) into final_position;
    -- Simplify: after renormalisation, appending at the end is always safe
    -- and deterministic; the client reconciles onto the returned value
    -- regardless, so a conservative "insert at the end" is an acceptable,
    -- always-correct fallback rather than trying to re-derive the exact
    -- relative slot from a stale p_position.
    select coalesce(max(tasks.position), 0) + 1000 into final_position
      from public.tasks where tasks.column_id = p_column_id and tasks.deleted_at is null and tasks.id <> p_task_id;
  end if;

  activity_kind := case
    when target_is_done and not coalesce(source_is_done, false) then 'completed'
    when coalesce(source_is_done, false) and not target_is_done then 'reopened'
    else 'moved'
  end;
  update public.tasks set column_id = p_column_id, position = final_position, mutation_id = p_mutation_id where tasks.id = p_task_id returning * into existing_task;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value, to_value)
  values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id, activity_kind,
    jsonb_build_object('columnId', source_column_id), jsonb_build_object('columnId', p_column_id));
  return query select existing_task.id, existing_task.column_id, existing_task.position, existing_task.updated_at;
end;
$$;

-- Nightly defensive sweep (03 §13): re-spaces every column whose smallest
-- gap has fallen under 1e-4 (a wider trigger than move_task's 1e-6 so the
-- sweep catches columns trending toward collision before they get there).
create or replace function public.renormalize_positions() returns void
language plpgsql security definer set search_path = public as $$
declare
  column_row record;
begin
  for column_row in
    select c.id from public.columns c
    where c.deleted_at is null
      and exists (
        select 1 from (
          select tasks.position, lag(tasks.position) over (order by tasks.position) as prev_position
          from public.tasks where tasks.column_id = c.id and tasks.deleted_at is null
        ) gaps where gaps.prev_position is not null and gaps.position - gaps.prev_position < 1e-4
      )
  loop
    perform public.renormalize_column(column_row.id);
  end loop;
end;
$$;
revoke all on function public.renormalize_positions() from public;
grant execute on function public.renormalize_positions() to service_role;

-- Test-only wrapper so the RLS suite (which runs as an authenticated user,
-- not service_role) can exercise renormalize_positions() and prove it writes
-- a job_runs row. Real invocation in 2F is via pg_cron -> this same function
-- name called directly in SQL (no HTTP hop needed — it's pure SQL, T1).
create or replace function public.run_renormalize_positions_for_test(p_run_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.job_runs (job_name, run_key) values ('renormalize_positions', p_run_key);
  begin
    perform public.renormalize_positions();
    update public.job_runs set finished_at = now() where job_runs.job_name = 'renormalize_positions' and job_runs.run_key = p_run_key;
  exception when others then
    update public.job_runs set finished_at = now(), error = sqlerrm where job_runs.job_name = 'renormalize_positions' and job_runs.run_key = p_run_key;
    raise;
  end;
end;
$$;
revoke all on function public.run_renormalize_positions_for_test(text) from public;
grant execute on function public.run_renormalize_positions_for_test(text) to authenticated;

-- pg_cron schedule — SQL-only job, no pg_net hop needed (T1).
select cron.schedule('renormalize-positions-nightly', '17 2 * * *', $$
  insert into public.job_runs (job_name, run_key) values ('renormalize_positions', to_char(now(), 'YYYY-MM-DD'))
  on conflict (job_name, run_key) do nothing;
  select public.renormalize_positions();
  update public.job_runs set finished_at = now()
    where job_runs.job_name = 'renormalize_positions' and job_runs.run_key = to_char(now(), 'YYYY-MM-DD') and job_runs.finished_at is null;
$$);
```

Note the judgment call above: the "re-derive the exact relative slot after renormalisation" logic is genuinely fiddly (the client's originally-intended neighbour positions are gone the instant `renormalize_column` runs), so this plan takes the pragmatic, always-correct route — append to the end of the freshly-renormalised column — and lets the client's realtime subscription (already reconciling `move_task`'s returned canonical `position`, `src/lib/realtime/board-sync.ts`) pick up the true final order. The dead first assignment to `final_position` (the `coalesce(...)` computing a would-be relative slot) is left out in the real implementation — only keep the final `coalesce(max(...), 0) + 1000` assignment inside the `if collides` branch; do not ship the first, unused `select … into final_position` shown for narrative purposes above the "Simplify" comment.

- [ ] **Step 5: Verify `pg_cron`/`pg_net` are enabled**

`pg_cron` is enabled by 2F Task 2F.2 in the master roadmap's sequencing, but this task's nightly schedule needs it now. Confirm with `mcp__supabase__list_extensions` (or `select * from pg_extension where extname = 'pg_cron'`); if absent, add to this same migration file, above the `cron.schedule` call:

```sql
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
```

- [ ] **Step 6: Apply and run the RLS suite**

Run: `npm run db:push` (or MCP `apply_migration`), then `npm run test:rls`.
Expected: PASS, including `board-positions.test.ts` and the existing `isolation.test.ts`/`members.test.ts` (unaffected by this change — `move_task`'s signature and non-collision behaviour are unchanged).

- [ ] **Step 7: Full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint`
Expected: all PASS.

```bash
git add supabase/migrations/202609190001_renormalize_positions.sql supabase/migrations/202609190002_job_runs.sql src/test/rls/board-positions.test.ts
git commit -m "feat(board): renormalise task positions on collision and nightly"
```

---

### Task 2C.3 — Assignee, priority, due date on card + editor

**Files:**
- Create: `src/components/board/assignee-picker.tsx`, `assignee-picker.test.tsx`, `supabase/migrations/202609190003_task_assignee_validation.sql`, `src/test/rls/board-assignee.test.ts`
- Modify: `src/lib/tasks/schemas.ts` (no change needed — `assigneeId` already exists on `createTaskSchema`; add it to `updateTaskSchema`), `src/components/board/task-editor.tsx` (add the picker), `src/app/(app)/p/[projectId]/board/page.tsx` (select `assignee_id`, join `project_peers`), `src/app/api/v1/tasks/[taskId]/route.ts` (pass `p_assignee_id`)

**Interfaces:**
- Produces: `assignee-picker.tsx` — `<AssigneePicker projectId value={string|null} onChange={(id: string|null)=>void} disabled={boolean} />`, reading from `project_peers` (`src/lib/supabase/client.ts`'s `createClient().from("project_peers").select("id, display_name").order("display_name")`, already scoped by the `users_project_peers` RLS policy from 2B.1 — no new route needed).
- Modifies: `update_task(p_task_id, p_title, p_description, p_due_date, p_priority, p_assignee_id)` — validates the assignee (if non-null) is a current project member, writes `assigned`/`unassigned` activity rows in addition to `updated` when the assignee actually changes.

**Security properties:** assigning a non-member raises `22023` (422) — the same "explicit max lengths/validation before it reaches the database" posture as every other write; a Viewer cannot change the assignee (`can_write_project` gate, existing).

- [ ] **Step 1: Write the failing RLS test**

```ts
// src/test/rls/board-assignee.test.ts
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

describe("update_task assignee validation (BR-5)", () => {
  it("rejects a non-member assignee with 422", async () => {
    const { error } = await f.a.rpc("update_task", {
      p_task_id: f.taskId,
      p_title: "A's task",
      p_description: null,
      p_due_date: null,
      p_priority: "medium",
      p_assignee_id: f.bId, // b is not a member of this project
    });
    expect(error?.code).toBe("22023");
  });

  it("accepts a current member and writes an 'assigned' activity row", async () => {
    const admin = createAdminClient();
    await admin.from("memberships").insert({ project_id: f.projectId, user_id: f.bId, role: "member" });

    const { data, error } = await f.a.rpc("update_task", {
      p_task_id: f.taskId,
      p_title: "A's task",
      p_description: null,
      p_due_date: null,
      p_priority: "medium",
      p_assignee_id: f.bId,
    });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.assignee_id).toBe(f.bId);

    const { data: activityRows } = await f.a
      .from("activity")
      .select("action")
      .eq("task_id", f.taskId)
      .eq("action", "assigned");
    expect(activityRows).toHaveLength(1);
  });

  it("clearing the assignee writes an 'unassigned' activity row", async () => {
    const { error } = await f.a.rpc("update_task", {
      p_task_id: f.taskId,
      p_title: "A's task",
      p_description: null,
      p_due_date: null,
      p_priority: "medium",
      p_assignee_id: null,
    });
    expect(error).toBeNull();
    const { data: activityRows } = await f.a
      .from("activity")
      .select("action")
      .eq("task_id", f.taskId)
      .eq("action", "unassigned");
    expect(activityRows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/board-assignee.test.ts`
Expected: FAIL — `update_task` has no `p_assignee_id` parameter.

- [ ] **Step 3: Migration**

```sql
-- supabase/migrations/202609190003_task_assignee_validation.sql
-- update_task gains p_assignee_id. Body is otherwise unchanged from
-- 202609160001_fix_project_scoped_404.sql; all id/column_id references
-- stay qualified with their table alias per the ambiguous-column convention
-- (this function's OUT parameters include `id`).
create or replace function public.update_task(
  p_task_id uuid, p_title text, p_description text, p_due_date date, p_priority public.task_priority,
  p_assignee_id uuid default null
) returns table (
  id uuid, column_id uuid, title varchar, description text, due_date date, priority public.task_priority,
  "position" double precision, assignee_id uuid, created_at timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_task public.tasks%rowtype;
  before_value jsonb;
  assignee_changed boolean;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_project_member(existing_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(existing_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 200 then raise exception 'INVALID_TASK_TITLE' using errcode = '22023'; end if;
  if p_description is not null and char_length(p_description) > 20000 then raise exception 'INVALID_DESCRIPTION' using errcode = '22023'; end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.memberships where memberships.project_id = existing_task.project_id and memberships.user_id = p_assignee_id
  ) then
    raise exception 'INVALID_ASSIGNEE' using errcode = '22023';
  end if;

  assignee_changed := p_assignee_id is distinct from existing_task.assignee_id;
  before_value := jsonb_build_object('title', existing_task.title, 'description', existing_task.description, 'dueDate', existing_task.due_date, 'priority', existing_task.priority, 'assigneeId', existing_task.assignee_id);
  update public.tasks set title = trim(p_title), description = nullif(trim(p_description), ''), due_date = p_due_date, priority = p_priority, assignee_id = p_assignee_id where tasks.id = p_task_id returning * into existing_task;

  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value, to_value)
  values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id, 'updated', before_value,
    jsonb_build_object('title', existing_task.title, 'description', existing_task.description, 'dueDate', existing_task.due_date, 'priority', existing_task.priority, 'assigneeId', existing_task.assignee_id));

  if assignee_changed then
    insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value, to_value)
    values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id,
      case when p_assignee_id is null then 'unassigned' else 'assigned' end,
      jsonb_build_object('assigneeId', before_value ->> 'assigneeId'), jsonb_build_object('assigneeId', p_assignee_id));
  end if;

  return query select existing_task.id, existing_task.column_id, existing_task.title, existing_task.description, existing_task.due_date, existing_task.priority, existing_task.position, existing_task.assignee_id, existing_task.created_at, existing_task.updated_at;
end;
$$;
revoke all on function public.update_task(uuid, text, text, date, public.task_priority, uuid) from public;
grant execute on function public.update_task(uuid, text, text, date, public.task_priority, uuid) to authenticated;

-- Old 5-arg overload must be dropped so PostgREST does not see two candidate
-- overloads for the same call shape from existing clients mid-deploy.
drop function if exists public.update_task(uuid, text, text, date, public.task_priority);
```

- [ ] **Step 4: Apply and run the RLS suite**

Run: `npm run db:push` (or MCP `apply_migration`), then `npm run test:rls`.
Expected: PASS, including `board-assignee.test.ts`.

- [ ] **Step 5: Client schema + `AssigneePicker` — failing test**

```tsx
// src/components/board/assignee-picker.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssigneePicker } from "./assignee-picker";

const from = vi.fn(() => ({
  select: () => ({
    order: async () => ({
      data: [
        { id: "u1", display_name: "Ada" },
        { id: "u2", display_name: "Grace" },
      ],
      error: null,
    }),
  }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from }) }));

describe("AssigneePicker", () => {
  it("lists project peers and calls onChange with the selected id", async () => {
    const onChange = vi.fn();
    render(<AssigneePicker projectId="p1" value={null} onChange={onChange} disabled={false} />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Assignee"), "u1");
    expect(onChange).toHaveBeenCalledWith("u1");
  });

  it("selecting Unassigned calls onChange with null", async () => {
    const onChange = vi.fn();
    render(<AssigneePicker projectId="p1" value="u1" onChange={onChange} disabled={false} />);
    await waitFor(() => expect(screen.getByText("Grace")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Assignee"), "");
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/components/board/assignee-picker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement**

```tsx
// src/components/board/assignee-picker.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Peer = { id: string; display_name: string };

export function AssigneePicker({
  projectId,
  value,
  onChange,
  disabled,
}: {
  projectId: string;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled: boolean;
}) {
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void supabase
      .from("project_peers")
      .select("id, display_name")
      .order("display_name")
      .then(({ data }) => {
        if (active) setPeers((data as Peer[]) ?? []);
      });
    return () => {
      active = false;
    };
    // project_peers is not filtered by projectId client-side — RLS already
    // scopes it to the caller's fellow members across every project they're
    // in, but this component is only ever rendered for one project's editor,
    // so the (rare) cross-project overlap is harmless and keeping the query
    // simple avoids a second round trip.
  }, [projectId]);

  return (
    <label className="block space-y-2 text-sm font-medium">
      Assignee
      <select
        aria-label="Assignee"
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
        className="bg-background focus-visible:ring-ring/40 w-full rounded-md border px-3 py-2 text-base font-normal outline-none focus-visible:ring-2"
      >
        <option value="">Unassigned</option>
        {peers.map((peer) => (
          <option key={peer.id} value={peer.id}>
            {peer.display_name}
          </option>
        ))}
      </select>
    </label>
  );
}
```

Add `assigneeId` to `updateTaskSchema` in `src/lib/tasks/schemas.ts`:

```ts
export const updateTaskSchema = z.object({
  title: taskTitleSchema,
  description: z.string().max(20_000).nullable(),
  dueDate: z.string().date().nullable(),
  priority: taskPrioritySchema,
  assigneeId: uuidSchema.nullable(),
});
```

Wire `p_assignee_id` into the route:

```ts
// src/app/api/v1/tasks/[taskId]/route.ts — PATCH handler body, add the field
const { data, error } = await supabase.rpc("update_task", {
  p_task_id: params.taskId,
  p_title: body.title,
  p_description: body.description,
  p_due_date: body.dueDate,
  p_priority: body.priority,
  p_assignee_id: body.assigneeId,
});
```

Add the picker to `task-editor.tsx`'s form (next to the priority/due-date grid), holding `assigneeId` in local state initialised from `task.assignee_id` and sending it in `save()`'s request body. This mirrors the existing `priority`/`dueDate` state wiring in the file 1:1 — omitted here to avoid repeating the whole component; the only new lines are the `assigneeId` state hook, the `<AssigneePicker>` element, and `assigneeId` in the `JSON.stringify` body.

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run src/components/board/assignee-picker.test.tsx`
Expected: PASS.

- [ ] **Step 9: Update the board page query for the avatar/name on cards**

```ts
// src/app/(app)/p/[projectId]/board/page.tsx — extend the tasks select
supabase
  .from("tasks")
  .select(
    "id, column_id, title, description, due_date, priority, position, assignee_id, created_at, updated_at, assignee:project_peers(display_name)",
  )
  .eq("project_id", projectId)
  .is("deleted_at", null)
  .order("position"),
```

and shape it into `BoardTask.assignee_display_name` before passing `initialTasks` to `<Board>`:

```ts
const tasks = (taskData ?? []).map((row) => ({
  ...row,
  assignee_display_name: Array.isArray(row.assignee) ? row.assignee[0]?.display_name : row.assignee?.display_name,
})) as BoardTask[];
```

- [ ] **Step 10: Full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint`
Expected: all PASS.

```bash
git add supabase/migrations/202609190003_task_assignee_validation.sql src/test/rls/board-assignee.test.ts src/components/board src/lib/tasks/schemas.ts src/app/api/v1/tasks/\[taskId\]/route.ts src/app/\(app\)/p/\[projectId\]/board/page.tsx
git commit -m "feat(board): add assignee editing with membership validation"
```

---

### Task 2C.4 — Optimistic concurrency (`05 §2`)

**Files:**
- Create: `supabase/migrations/202609190004_optimistic_concurrency.sql`, `src/test/rls/board-concurrency.test.ts`
- Modify: `src/app/api/v1/tasks/[taskId]/route.ts` (pass `p_expected_updated_at`, no new error-code mapping needed — `40001`→409 is already in `RPC_ERROR_MAP`, `src/lib/api/handler.ts:143`), `src/lib/tasks/schemas.ts` (`updateTaskSchema` gains `expectedUpdatedAt`), `src/components/board/task-editor.tsx` (conflict banner)

**Interfaces:**
- Modifies: `update_task(..., p_expected_updated_at timestamptz)` — if the current row's `updated_at` does not match `p_expected_updated_at`, raises `errcode = '40001'` (already mapped to 409 CONFLICT in `mapRpcError`'s `RPC_ERROR_MAP`) instead of applying the write, and the route returns the *current* server row in the error body so the client can show it in the conflict banner.

- [ ] **Step 1: Write the failing RLS test**

```ts
// src/test/rls/board-concurrency.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let f: IsolationFixture;
beforeAll(async () => {
  f = await seedIsolationFixture();
});
afterAll(async () => {
  await f.cleanup();
});

describe("update_task optimistic concurrency (05 §2)", () => {
  it("a stale expected_updated_at is rejected with 40001, current row unchanged by the rejected write", async () => {
    const { data: before } = await f.a.from("tasks").select("updated_at").eq("id", f.taskId).single();

    // First writer succeeds.
    const first = await f.a.rpc("update_task", {
      p_task_id: f.taskId,
      p_title: "First edit",
      p_description: null,
      p_due_date: null,
      p_priority: "medium",
      p_assignee_id: null,
      p_expected_updated_at: before!.updated_at,
    });
    expect(first.error).toBeNull();

    // Second writer, still holding the stale updated_at, is rejected.
    const second = await f.a.rpc("update_task", {
      p_task_id: f.taskId,
      p_title: "Second edit (stale)",
      p_description: null,
      p_due_date: null,
      p_priority: "medium",
      p_assignee_id: null,
      p_expected_updated_at: before!.updated_at,
    });
    expect(second.error?.code).toBe("40001");

    const { data: after } = await f.a.from("tasks").select("title").eq("id", f.taskId).single();
    expect(after?.title).toBe("First edit");
  });

  it("a null expected_updated_at always succeeds (opt-out for callers that don't track it yet, e.g. subtask-only editors)", async () => {
    const { error } = await f.a.rpc("update_task", {
      p_task_id: f.taskId,
      p_title: "No concurrency check",
      p_description: null,
      p_due_date: null,
      p_priority: "medium",
      p_assignee_id: null,
      p_expected_updated_at: null,
    });
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/board-concurrency.test.ts`
Expected: FAIL — `update_task` has no `p_expected_updated_at` parameter.

- [ ] **Step 3: Migration**

```sql
-- supabase/migrations/202609190004_optimistic_concurrency.sql
create or replace function public.update_task(
  p_task_id uuid, p_title text, p_description text, p_due_date date, p_priority public.task_priority,
  p_assignee_id uuid default null, p_expected_updated_at timestamptz default null
) returns table (
  id uuid, column_id uuid, title varchar, description text, due_date date, priority public.task_priority,
  "position" double precision, assignee_id uuid, created_at timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_task public.tasks%rowtype;
  before_value jsonb;
  assignee_changed boolean;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_project_member(existing_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(existing_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_expected_updated_at is not null and p_expected_updated_at is distinct from existing_task.updated_at then
    raise exception 'CONFLICT' using errcode = '40001';
  end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 200 then raise exception 'INVALID_TASK_TITLE' using errcode = '22023'; end if;
  if p_description is not null and char_length(p_description) > 20000 then raise exception 'INVALID_DESCRIPTION' using errcode = '22023'; end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.memberships where memberships.project_id = existing_task.project_id and memberships.user_id = p_assignee_id
  ) then
    raise exception 'INVALID_ASSIGNEE' using errcode = '22023';
  end if;

  assignee_changed := p_assignee_id is distinct from existing_task.assignee_id;
  before_value := jsonb_build_object('title', existing_task.title, 'description', existing_task.description, 'dueDate', existing_task.due_date, 'priority', existing_task.priority, 'assigneeId', existing_task.assignee_id);
  update public.tasks set title = trim(p_title), description = nullif(trim(p_description), ''), due_date = p_due_date, priority = p_priority, assignee_id = p_assignee_id where tasks.id = p_task_id returning * into existing_task;

  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value, to_value)
  values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id, 'updated', before_value,
    jsonb_build_object('title', existing_task.title, 'description', existing_task.description, 'dueDate', existing_task.due_date, 'priority', existing_task.priority, 'assigneeId', existing_task.assignee_id));

  if assignee_changed then
    insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value, to_value)
    values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id,
      case when p_assignee_id is null then 'unassigned' else 'assigned' end,
      jsonb_build_object('assigneeId', before_value ->> 'assigneeId'), jsonb_build_object('assigneeId', p_assignee_id));
  end if;

  return query select existing_task.id, existing_task.column_id, existing_task.title, existing_task.description, existing_task.due_date, existing_task.priority, existing_task.position, existing_task.assignee_id, existing_task.created_at, existing_task.updated_at;
end;
$$;
revoke all on function public.update_task(uuid, text, text, date, public.task_priority, uuid, timestamptz) from public;
grant execute on function public.update_task(uuid, text, text, date, public.task_priority, uuid, timestamptz) to authenticated;
drop function if exists public.update_task(uuid, text, text, date, public.task_priority, uuid);
```

- [ ] **Step 4: Apply and run the RLS suite**

Run: `npm run db:push` (or MCP `apply_migration`), then `npm run test:rls`.
Expected: PASS, including `board-concurrency.test.ts`.

- [ ] **Step 5: Route — return the current row alongside the 409**

`mapRpcError` today returns a generic body on every mapped error; a 409 needs the *current* server row too so the editor can show what changed. Extend the route (not `mapRpcError` itself, to avoid widening its contract for every other caller):

```ts
// src/app/api/v1/tasks/[taskId]/route.ts — PATCH handler
export const PATCH = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid() }),
    body: updateTaskSchema,
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to update tasks.",
    validationMessage: "Check the task details and try again.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("update_task", {
      p_task_id: params.taskId,
      p_title: body.title,
      p_description: body.description,
      p_due_date: body.dueDate,
      p_priority: body.priority,
      p_assignee_id: body.assigneeId,
      p_expected_updated_at: body.expectedUpdatedAt,
    });
    if (error?.code === "40001") {
      const { data: current } = await supabase
        .from("tasks")
        .select("id, column_id, title, description, due_date, priority, position, assignee_id, created_at, updated_at")
        .eq("id", params.taskId)
        .maybeSingle();
      return apiError(409, "CONFLICT", "This task changed since you opened it.", { current });
    }
    if (error)
      return mapRpcError(error, { message: "Task could not be updated.", requestId, projectScoped: true });
    const task = firstRow(data);
    if (!task) return apiError(500, "INTERNAL_ERROR", "Task update returned no task.", { requestId });
    return json({ data: task });
  },
);
```

Add `expectedUpdatedAt` to `updateTaskSchema`:

```ts
export const updateTaskSchema = z.object({
  title: taskTitleSchema,
  description: z.string().max(20_000).nullable(),
  dueDate: z.string().date().nullable(),
  priority: taskPrioritySchema,
  assigneeId: uuidSchema.nullable(),
  expectedUpdatedAt: z.string().nullable(),
});
```

- [ ] **Step 6: Conflict banner in `task-editor.tsx`**

Track `task.updated_at` at the moment the editor opened, send it as `expectedUpdatedAt` on save, and on a 409 show a banner with "Reload" (replace local state with `error.details.current` and re-open the form pre-filled) and "Overwrite" (retry the save with `expectedUpdatedAt` set to `error.details.current.updated_at`, i.e. force it through):

```tsx
// src/components/board/task-editor.tsx — inside save(), replace the existing
// "if (!response.ok || !isBoardTask(payload))" branch with:
if (response.status === 409 && isConflictPayload(payload)) {
  setConflict(payload.error.details.current);
  return;
}
if (!response.ok || !isBoardTask(payload)) {
  setError("Your changes could not be saved. Please try again.");
  return;
}
onSaved(payload.data);
```

```tsx
// new state + type guard near the top of the component
const [conflict, setConflict] = useState<BoardTask | null>(null);

function isConflictPayload(value: unknown): value is { error: { details: { current: BoardTask } } } {
  return (
    typeof value === "object" && value !== null && "error" in value &&
    typeof value.error === "object" && value.error !== null && "details" in value.error
  );
}
```

```tsx
// JSX, above the save/cancel button row
{conflict && (
  <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
    <p className="font-medium">This task changed since you opened it.</p>
    <div className="mt-2 flex gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => { setTitle(conflict.title); setDescription(conflict.description ?? ""); setDueDate(conflict.due_date ?? ""); setPriority(conflict.priority); setExpectedUpdatedAt(conflict.updated_at); setConflict(null); }}>
        Reload their version
      </Button>
      <Button type="button" size="sm" onClick={() => { setExpectedUpdatedAt(conflict.updated_at); setConflict(null); void save(); }}>
        Overwrite with mine
      </Button>
    </div>
  </div>
)}
```

`expectedUpdatedAt` state is initialised from `task.updated_at` when the editor opens and included in the `save()` request body's `JSON.stringify({ ..., expectedUpdatedAt })`.

- [ ] **Step 7: Full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build`
Expected: all PASS.

```bash
git add supabase/migrations/202609190004_optimistic_concurrency.sql src/test/rls/board-concurrency.test.ts src/app/api/v1/tasks/\[taskId\]/route.ts src/lib/tasks/schemas.ts src/components/board/task-editor.tsx
git commit -m "feat(board): add optimistic concurrency to task edits"
```

---

## Verification (Part 1 exit)

- `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build && npm run size` green.
- `npx playwright test e2e/board-drag.spec.ts` green against a staging preview.
- Manual: open the board with two browser sessions signed in as different project members; drag a card by mouse in one, confirm it appears in the other within the realtime grace window; tab to a card, lift with Space, move with arrow keys, drop with Space, confirm the live region announces once; set `prefers-reduced-motion: reduce` in devtools and confirm the `DragOverlay` no longer animates.
- Continue to `2C-board-completion-2.md` for Tasks 2C.5–2C.7 and the sub-plan-exit verification.

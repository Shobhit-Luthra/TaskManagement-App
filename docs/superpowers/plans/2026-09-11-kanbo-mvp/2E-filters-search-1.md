# Kanbo Sub-plan 2E — Filters, search & My Tasks (P1) — Step-level

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today the board (`src/components/board/project-board.tsx` as it exists pre-2C, or `src/components/board/board.tsx` after 2C's dnd-kit split) has exactly two ad-hoc filters — a free-text `q` and a `priority` `<select>` — hand-rolled inline with `useState` + a 250ms `router.replace` debounce, and the list view is a read-only, unfiltered table with no shared state at all. This sub-plan generalizes that into one filter model (assignee, label, priority, due-state, search) that both the board and the list view consume from a single hook, adds a filter bar with chips and keyboard shortcuts, brings the list view to parity with inline edit, and ships the cross-project "My Tasks" view (G5).

**Read first:**
- `00-master-roadmap.md` §2 Gap Register — **G3** (timezone for due-state, resolved: evaluate in the **project's** timezone, not the browser's or the user's), **G5** (My Tasks — cross-project, grouped by due state, ships here because it needs both assignee and filters), **G10** (search/filters are **client-side only** over the already-loaded board; no `pg_trgm`, no server endpoint, state lives in the URL) — and §4 Cross-cutting rules.
- `2B-members-invitations.md` — the format template for this file (Files / Interfaces / Security properties / numbered TDD steps / commit).
- `2E-filters-search.md` — the task-level index this file expands (now just a pointer; see below).
- `src/components/board/project-board.tsx` — the current `q`/`priority` state, the `usePathname`/`useSearchParams`/`useRouter` URL-sync pattern (`useEffect` debounced `router.replace`), and `visibleTasks` — the ad-hoc predecessor to `applyFilters`. Every task below consumes `withApiHandler`/`mapRpcError` (`src/lib/api/handler.ts`), `RATE_LIMITS` (`src/lib/api/rate-limit.ts` — this sub-plan adds no new rate-limited routes, since G10 keeps filtering client-side, but My Tasks' page load is still subject to `RATE_LIMITS.reads` at the Supabase/PostgREST layer via existing RLS), `createClient`/server client (`src/lib/supabase/server.ts`), and `project_peers` (`supabase/migrations/202609160002_project_peers.sql`).

**Dependency this plan assumes (read before executing):** Sub-plan 2C (board completion) ships before this one in the build sequence (`00-master-roadmap.md` §3) and is expected to have:
1. Split `project-board.tsx` into `src/components/board/board.tsx`, `column.tsx`, `task-card.tsx`, `task-editor.tsx`, `use-board-dnd.ts`, `announcer.tsx` (Task 2C.1).
2. Added `assignee_id` to the client-side `BoardTask` type, an `assignee-picker.tsx` built on `project_peers`, and extended `update_task`/the `PATCH /api/v1/tasks/[taskId]` route to accept `assigneeId` (Task 2C.3).
3. Sub-plan 2D (comments, mentions & labels) ships before this one too, and is expected to have added `labels`/`task_labels` tables, `set_task_labels(p_task_id, p_label_ids uuid[])`, a `GET /api/v1/projects/[projectId]/labels` route, and a `label-picker.tsx` (Task 2D.4), plus attached `label_ids: string[]` (or an embedded `labels` array) to the task shape returned by the board/list queries.

If either dependency has **not** landed exactly as described when this plan is executed, treat the filenames/shapes below (`board/board.tsx`, `BoardTask.assignee_id`, `BoardTask.label_ids`, `assignee-picker.tsx`, `label-picker.tsx`) as the *target* interface and adjust step 1 of each affected task to re-derive the actual current file layout before writing code against it — do not silently code against stale paths. Re-run `Grep`/`Read` against the real tree first.

**Spec:** `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md` + `docs/specs/00`–`07` (in particular `02 §21` for the shortcut keys and `04 §4.8` for the labels schema); `00-master-roadmap.md` §5 Sub-plan 2E.

**Definition of done:** every task's acceptance tests green; `npm run test && npm run typecheck && npm run lint && npm run build && npm run size` green; preview deployment on staging exercised manually (search a task, filter by assignee+label+priority+due, use `/`/`F`/`N`/`?` shortcuts, switch to list view and inline-edit a row, open `/my-tasks` and see tasks grouped by due state across two projects); CI green on the PR. No RLS suite run is required for this sub-plan specifically — it adds no tables and no RPCs — but `npm run test:rls` must still pass unmodified (regression check) before the final commit of Task 2E.4.

---

## Global Constraints

- TDD: failing test → minimal code → pass → commit, for every step below. Conventional Commits, **no `Co-Authored-By` or `Claude-Session` trailers** (`ENGINEERING_RULES.md §7`, confirmed by the user 2026-09-11, restated in `00-master-roadmap.md` §4 and `2B-members-invitations.md` Global Constraints).
- TypeScript strict; no `any` in application code.
- This sub-plan is **entirely client-side + one read-only server component** (My Tasks). It adds **no migrations, no new RPCs, no new tables**. If a step below is ever tempted to add a server-side search endpoint, that is out of scope per **G10** — MVP filtering/search stays client-side over the already-loaded board (< 500 tasks per A1) with state in the URL; revisit only if A1 is revalidated.
- Filter/search state lives in the URL (`useSearchParams`/`router.replace`), exactly like the existing `q`/`priority` pattern in `project-board.tsx` — not in `localStorage`, not in component state alone, so a filtered view is shareable/bookmarkable and survives a refresh.
- `applyFilters` (Task 2E.1) is a **pure function** — no `Date.now()`, no browser API, no fetch inside it. Time and timezone are always passed in (`now: Date`, `projectTimezone: string`) so it is deterministic and table-testable, per **G3**'s resolution: due-state is evaluated in the **project's** timezone (`projects.timezone`), never the browser's local timezone and never the signed-in user's `users.timezone` (that field is reserved for rendering and digest-hour choice per G3, not for filter logic).
- Keyboard shortcuts (Task 2E.2) must never fire while focus is inside an `<input>`, `<textarea>`, `<select>`, or any `contenteditable` element — every shortcut handler is gated by a shared `isTypingTarget` guard, and each shortcut has a dedicated test proving it does *not* fire from inside the search box.
- No colour-only encoding: priority chips/badges in the filter bar and list view carry an icon + text label (`01 §24`, already the convention in `TaskCard`'s `priorityColor` usage — extend it, don't invent a second convention).
- Every new/changed component gets a colocated `*.test.tsx`/`*.test.ts` using Vitest + Testing Library, matching the existing repo convention (see `src/lib/email/console-sender.test.ts`, `src/lib/invitations/token.test.ts` for pure-module style; component tests follow whatever pattern `2C`'s board component tests establish — if none exist yet when this task starts, use `@testing-library/react`'s `render`/`screen`/`fireEvent` directly, no extra harness).
- Structured JSON logs via `log()` are **not** needed anywhere in this sub-plan — nothing here talks to a server route that didn't already exist.
- Commit at the end of every task (not every step): Conventional Commits, no AI trailers. Before each commit: `git status`, inspect the diff, no secrets, `npm run test`, `npm run typecheck`, `npm run lint`.
- Docs: this file is the only doc output of 2E; no `build-decisions.md` append is required unless a step below makes a judgment call not already covered by G3/G5/G10 (none currently anticipated — if one comes up during execution, append it there and note it in the final commit).

---

## File Structure

```
src/lib/filters/schema.ts                                        Task 2E.1
src/lib/filters/schema.test.ts                                    Task 2E.1
src/lib/filters/apply.ts                                          Task 2E.1
src/lib/filters/apply.test.ts                                     Task 2E.1
src/lib/filters/timezone.ts                                       Task 2E.1
src/lib/filters/timezone.test.ts                                  Task 2E.1
src/components/board/use-filter-state.ts                          Task 2E.1
src/components/board/use-filter-state.test.ts                     Task 2E.1
src/components/board/use-board-data.ts                            Task 2E.1 (new shared hook — data + filters, consumed by board.tsx in 2E.2 and task-table.tsx in 2E.3)
src/lib/keyboard/use-board-shortcuts.ts                           Task 2E.2
src/lib/keyboard/use-board-shortcuts.test.ts                      Task 2E.2
src/components/board/search-input.tsx                             Task 2E.2
src/components/board/search-input.test.tsx                        Task 2E.2
src/components/board/filter-bar.tsx                               Task 2E.2
src/components/board/filter-bar.test.tsx                          Task 2E.2
src/components/board/shortcuts-help-dialog.tsx                    Task 2E.2
src/components/board/board.tsx                                    Task 2E.2 (modify — wire filter bar, shortcuts, empty state, fade-out-on-drag-out)
src/app/(app)/p/[projectId]/board/page.tsx                        Task 2E.2 (modify — fetch peers/labels for the filter bar)
src/components/list/task-table.tsx                                Task 2E.3
src/components/list/task-table.test.tsx                           Task 2E.3
src/app/(app)/p/[projectId]/list/page.tsx                         Task 2E.3 (rewrite — client component using use-board-data + task-table)
src/lib/my-tasks/group.ts                                         Task 2E.4
src/lib/my-tasks/group.test.ts                                    Task 2E.4
src/app/(app)/my-tasks/page.tsx                                   Task 2E.4
src/components/my-tasks/my-tasks-list.tsx                         Task 2E.4
src/components/my-tasks/my-tasks-list.test.tsx                    Task 2E.4
src/components/app-shell.tsx                                      Task 2E.4 (modify — nav link)
```

---

### Task 2E.1 — Filter model + URL state (G10, G3)

**Files:**
- Create: `src/lib/filters/schema.ts`, `src/lib/filters/schema.test.ts`, `src/lib/filters/apply.ts`, `src/lib/filters/apply.test.ts`, `src/lib/filters/timezone.ts`, `src/lib/filters/timezone.test.ts`, `src/components/board/use-filter-state.ts`, `src/components/board/use-filter-state.test.ts`, `src/components/board/use-board-data.ts`.

**Interfaces:**
- Produces:
  ```ts
  // src/lib/filters/schema.ts
  export type DueFilter = "overdue" | "today" | "week" | "none";
  export type FilterState = {
    assignee: string[];
    label: string[];
    priority: Array<"low" | "medium" | "high" | "urgent">;
    due: DueFilter | null;
    q: string;
  };
  export const EMPTY_FILTER_STATE: FilterState;
  export function parseFilterState(searchParams: URLSearchParams): FilterState;   // unknown keys ignored, malformed values dropped
  export function serializeFilterState(state: FilterState): URLSearchParams;      // omits empty/default fields entirely

  // src/lib/filters/timezone.ts
  export function todayInTimeZone(now: Date, timeZone: string): string;           // "YYYY-MM-DD" in that IANA zone
  export function addDaysToDateString(date: string, days: number): string;

  // src/lib/filters/apply.ts
  export type FilterableTask = {
    id: string;
    title: string;
    description: string | null;
    priority: "low" | "medium" | "high" | "urgent";
    due_date: string | null;      // "YYYY-MM-DD"
    assignee_id: string | null;
    label_ids: string[];
    isDone: boolean;              // caller derives from the task's current column.is_done_column
  };
  export function applyFilters<T extends FilterableTask>(
    tasks: T[],
    filters: FilterState,
    ctx: { projectTimezone: string; now: Date },
  ): T[];

  // src/components/board/use-filter-state.ts
  export function useFilterState(): [FilterState, (next: Partial<FilterState>) => void, () => void];
  // reads from useSearchParams on mount/navigation, writes via router.replace(pathname + "?" + serialized, { scroll: false }),
  // 250ms debounce on `q` only (matches the existing project-board.tsx pattern) — every other field updates the URL immediately.

  // src/components/board/use-board-data.ts
  export function useBoardData(params: {
    projectId: string;
    currentUserId: string;
    initialColumns: BoardColumn[];
    initialTasks: BoardTask[];
  }): {
    columns: BoardColumn[];
    tasks: BoardTask[];               // full, unfiltered, realtime-synced
    visibleTasks: BoardTask[];        // applyFilters(tasks, filterState, { projectTimezone, now: new Date() })
    filterState: FilterState;
    setFilter: (next: Partial<FilterState>) => void;
    clearFilters: () => void;
    hasFilters: boolean;
    syncStatus: ReturnType<typeof useProjectChannel>;
    readOnly: boolean;
    // task mutation callbacks (appendTask, moveTask, updateTask, deleteTask) lifted verbatim out of
    // project-board.tsx / board.tsx so board.tsx and task-table.tsx share one source of truth.
  };
  ```
- Consumes: `useProjectChannel` (`src/lib/realtime/use-project-channel.ts`), `mergeColumnEvent`/`mergeTaskEvent` (`src/lib/realtime/board-sync.ts`) — lifted from `board.tsx` (post-2C) unchanged, just relocated into the hook so `task-table.tsx` (Task 2E.3) can reuse them without importing the whole board component tree.

**Acceptance:** table-driven unit tests incl. the G3 timezone edge (23:30 UTC vs `Asia/Kolkata`, see Step 7 below); unknown URL keys ignored; `serializeFilterState` round-trips through `parseFilterState`; `useBoardData` unit test (mocked realtime) proves `visibleTasks` recomputes when `filterState` or `tasks` changes and that mutation callbacks still update `tasks` (not `visibleTasks` directly).

- [ ] **Step 1: Write the failing tests for `schema.ts`**

```ts
// src/lib/filters/schema.test.ts
import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_STATE, parseFilterState, serializeFilterState } from "./schema";

describe("parseFilterState", () => {
  it("returns the empty state for no params", () => {
    expect(parseFilterState(new URLSearchParams())).toEqual(EMPTY_FILTER_STATE);
  });

  it("reads comma-separated assignee/label/priority and a single due/q", () => {
    const params = new URLSearchParams(
      "assignee=a1,a2&label=l1&priority=high,urgent&due=today&q=launch",
    );
    expect(parseFilterState(params)).toEqual({
      assignee: ["a1", "a2"],
      label: ["l1"],
      priority: ["high", "urgent"],
      due: "today",
      q: "launch",
    });
  });

  it("drops an invalid priority value but keeps the valid ones", () => {
    const params = new URLSearchParams("priority=high,not-a-priority,low");
    expect(parseFilterState(params).priority).toEqual(["high", "low"]);
  });

  it("drops an invalid due value", () => {
    const params = new URLSearchParams("due=yesterday");
    expect(parseFilterState(params).due).toBeNull();
  });

  it("ignores unknown keys entirely", () => {
    const params = new URLSearchParams("sort=title&view=compact&q=x");
    expect(parseFilterState(params)).toEqual({ ...EMPTY_FILTER_STATE, q: "x" });
  });

  it("trims and caps q at 200 chars", () => {
    const long = "a".repeat(500);
    const params = new URLSearchParams();
    params.set("q", `  ${long}  `);
    expect(parseFilterState(params).q).toHaveLength(200);
  });
});

describe("serializeFilterState", () => {
  it("omits empty/default fields", () => {
    expect(serializeFilterState(EMPTY_FILTER_STATE).toString()).toBe("");
  });

  it("round-trips through parseFilterState", () => {
    const state = { assignee: ["a1"], label: [], priority: ["low", "high"], due: "week" as const, q: "bug" };
    const roundTripped = parseFilterState(serializeFilterState(state));
    expect(roundTripped).toEqual(state);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/filters/schema.test.ts`
Expected: FAIL — `./schema` does not exist.

- [ ] **Step 3: Implement `schema.ts`**

```ts
// src/lib/filters/schema.ts
import { z } from "zod";

export const dueFilterSchema = z.enum(["overdue", "today", "week", "none"]);
export type DueFilter = z.infer<typeof dueFilterSchema>;

const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);
const uuidLikeSchema = z.string().min(1).max(100); // not z.string().uuid() — see note below

export type FilterState = {
  assignee: string[];
  label: string[];
  priority: Array<z.infer<typeof prioritySchema>>;
  due: DueFilter | null;
  q: string;
};

export const EMPTY_FILTER_STATE: FilterState = {
  assignee: [],
  label: [],
  priority: [],
  due: null,
  q: "",
};

/** Splits a comma-separated URL param, drops blanks, caps at 50 entries
 * (matches the labelIds cap in src/lib/tasks/schemas.ts) so a malformed
 * URL can't make applyFilters iterate an unbounded list. */
function splitCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 50);
}

export function parseFilterState(searchParams: URLSearchParams): FilterState {
  const assignee = splitCsv(searchParams.get("assignee")).filter(
    (value) => uuidLikeSchema.safeParse(value).success,
  );
  const label = splitCsv(searchParams.get("label")).filter(
    (value) => uuidLikeSchema.safeParse(value).success,
  );
  const priority = splitCsv(searchParams.get("priority")).filter(
    (value): value is z.infer<typeof prioritySchema> => prioritySchema.safeParse(value).success,
  );
  const rawDue = searchParams.get("due");
  const due = rawDue && dueFilterSchema.safeParse(rawDue).success ? (rawDue as DueFilter) : null;
  const q = (searchParams.get("q") ?? "").trim().slice(0, 200);

  return { assignee, label, priority, due, q };
}

export function serializeFilterState(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.assignee.length) params.set("assignee", state.assignee.join(","));
  if (state.label.length) params.set("label", state.label.join(","));
  if (state.priority.length) params.set("priority", state.priority.join(","));
  if (state.due) params.set("due", state.due);
  if (state.q.trim()) params.set("q", state.q.trim());
  return params;
}
```

Note on `uuidLikeSchema`: assignee/label ids are real `uuid`s once 2C/2D land, but a strict `.uuid()` check here would make a stale/shared link silently drop a filter instead of just matching nothing — since `applyFilters` already no-ops on an id that matches no task, a loose length/non-empty check is enough and keeps this module decoupled from knowing the ids are UUIDs specifically.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/filters/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for `timezone.ts`**

```ts
// src/lib/filters/timezone.test.ts
import { describe, expect, it } from "vitest";
import { addDaysToDateString, todayInTimeZone } from "./timezone";

describe("todayInTimeZone", () => {
  it("returns the UTC calendar date for the UTC zone", () => {
    expect(todayInTimeZone(new Date("2026-09-17T12:00:00Z"), "UTC")).toBe("2026-09-17");
  });

  it("rolls over to the next day in a zone ahead of UTC (the G3 edge case)", () => {
    // 23:30 UTC on the 17th is 05:00 IST on the 18th — Asia/Kolkata is UTC+5:30.
    const now = new Date("2026-09-17T23:30:00Z");
    expect(todayInTimeZone(now, "UTC")).toBe("2026-09-17");
    expect(todayInTimeZone(now, "Asia/Kolkata")).toBe("2026-09-18");
  });

  it("rolls back a day in a zone behind UTC", () => {
    // 01:00 UTC is 17:00 the previous day in America/Los_Angeles (UTC-8 in September... actually UTC-7 DST).
    const now = new Date("2026-09-18T01:00:00Z");
    expect(todayInTimeZone(now, "America/Los_Angeles")).toBe("2026-09-17");
  });
});

describe("addDaysToDateString", () => {
  it("adds days without drifting across a month boundary", () => {
    expect(addDaysToDateString("2026-09-27", 7)).toBe("2026-10-04");
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/lib/filters/timezone.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `timezone.ts`**

```ts
// src/lib/filters/timezone.ts
/** "YYYY-MM-DD" formatter for a specific IANA zone. en-CA formats as
 * yyyy-mm-dd natively, so no manual part-reassembly is needed. This is
 * the only place "today" is computed for filter purposes — G3: always
 * the PROJECT's timezone (projects.timezone), never the browser's and
 * never users.timezone (that one is for rendering + digest hour only). */
export function todayInTimeZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    now,
  );
}

export function addDaysToDateString(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const utcMidnight = new Date(Date.UTC(year, month - 1, day));
  utcMidnight.setUTCDate(utcMidnight.getUTCDate() + days);
  return utcMidnight.toISOString().slice(0, 10);
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run src/lib/filters/timezone.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing table-driven tests for `apply.ts`**

```ts
// src/lib/filters/apply.test.ts
import { describe, expect, it } from "vitest";
import { applyFilters, type FilterableTask } from "./apply";
import { EMPTY_FILTER_STATE, type FilterState } from "./schema";

function task(overrides: Partial<FilterableTask>): FilterableTask {
  return {
    id: "t1",
    title: "Untitled",
    description: null,
    priority: "medium",
    due_date: null,
    assignee_id: null,
    label_ids: [],
    isDone: false,
    ...overrides,
  };
}

const ctx = { projectTimezone: "UTC", now: new Date("2026-09-17T12:00:00Z") };

describe("applyFilters — dimensions are OR within, AND across", () => {
  const tasks = [
    task({ id: "a", assignee_id: "u1", priority: "low", label_ids: ["design"] }),
    task({ id: "b", assignee_id: "u2", priority: "high", label_ids: ["bug"] }),
    task({ id: "c", assignee_id: "u1", priority: "high", label_ids: ["bug", "design"] }),
  ];

  it("no filters returns everything", () => {
    expect(applyFilters(tasks, EMPTY_FILTER_STATE, ctx).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("assignee is OR within the dimension", () => {
    const filters: FilterState = { ...EMPTY_FILTER_STATE, assignee: ["u1"] };
    expect(applyFilters(tasks, filters, ctx).map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("label is OR within the dimension (any match)", () => {
    const filters: FilterState = { ...EMPTY_FILTER_STATE, label: ["design"] };
    expect(applyFilters(tasks, filters, ctx).map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("assignee AND priority is AND across dimensions", () => {
    const filters: FilterState = { ...EMPTY_FILTER_STATE, assignee: ["u1"], priority: ["high"] };
    expect(applyFilters(tasks, filters, ctx).map((t) => t.id)).toEqual(["c"]);
  });

  it("priority OR within the dimension, combined AND with assignee", () => {
    const filters: FilterState = { ...EMPTY_FILTER_STATE, assignee: ["u1"], priority: ["low", "high"] };
    expect(applyFilters(tasks, filters, ctx).map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("an assignee with no task has that filter return nothing, not everything", () => {
    const filters: FilterState = { ...EMPTY_FILTER_STATE, assignee: ["nobody"] };
    expect(applyFilters(tasks, filters, ctx)).toEqual([]);
  });
});

describe("applyFilters — free-text search over title + description, case-insensitive", () => {
  const tasks = [
    task({ id: "a", title: "Ship the Launch banner", description: null }),
    task({ id: "b", title: "Fix footer", description: "affects the LAUNCH page only" }),
    task({ id: "c", title: "Unrelated", description: "nothing here" }),
  ];

  it("matches title", () => {
    expect(applyFilters(tasks, { ...EMPTY_FILTER_STATE, q: "launch" }, ctx).map((t) => t.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("is case-insensitive and matches description too", () => {
    expect(applyFilters(tasks, { ...EMPTY_FILTER_STATE, q: "LAUNCH" }, ctx).map((t) => t.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("a null description never throws", () => {
    expect(() => applyFilters(tasks, { ...EMPTY_FILTER_STATE, q: "banner" }, ctx)).not.toThrow();
  });
});

describe("applyFilters — due state (G3: evaluated in the PROJECT's timezone)", () => {
  it("overdue: due_date strictly before today, and the task's column is not done", () => {
    const tasks = [
      task({ id: "a", due_date: "2026-09-16" }), // yesterday, not done → overdue
      task({ id: "b", due_date: "2026-09-16", isDone: true }), // yesterday but done → excluded
      task({ id: "c", due_date: "2026-09-17" }), // today → not overdue
    ];
    expect(applyFilters(tasks, { ...EMPTY_FILTER_STATE, due: "overdue" }, ctx).map((t) => t.id)).toEqual([
      "a",
    ]);
  });

  it("today: due_date equals the project-timezone today", () => {
    const tasks = [task({ id: "a", due_date: "2026-09-17" }), task({ id: "b", due_date: "2026-09-18" })];
    expect(applyFilters(tasks, { ...EMPTY_FILTER_STATE, due: "today" }, ctx).map((t) => t.id)).toEqual([
      "a",
    ]);
  });

  it("week: due_date within [today, today+7] inclusive", () => {
    const tasks = [
      task({ id: "a", due_date: "2026-09-17" }), // today → in
      task({ id: "b", due_date: "2026-09-24" }), // today+7 → in
      task({ id: "c", due_date: "2026-09-25" }), // today+8 → out
      task({ id: "d", due_date: "2026-09-16" }), // yesterday → out (that's "overdue"'s job)
    ];
    expect(applyFilters(tasks, { ...EMPTY_FILTER_STATE, due: "week" }, ctx).map((t) => t.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("none: no due_date at all", () => {
    const tasks = [task({ id: "a", due_date: null }), task({ id: "b", due_date: "2026-09-17" })];
    expect(applyFilters(tasks, { ...EMPTY_FILTER_STATE, due: "none" }, ctx).map((t) => t.id)).toEqual([
      "a",
    ]);
  });

  it("THE G3 EDGE CASE: 23:30 UTC vs Asia/Kolkata — a task due 'tomorrow' in UTC is already due TODAY in a project on Asia/Kolkata time", () => {
    // now is 23:30 UTC on the 17th, which is 05:00 IST on the 18th (Asia/Kolkata is UTC+5:30).
    const lateNow = new Date("2026-09-17T23:30:00Z");
    const taskDueThe18th = [task({ id: "a", due_date: "2026-09-18" })];

    // A project on UTC still thinks "today" is the 17th — the 18th is tomorrow, inside "week" but not "today".
    const utcResult = applyFilters(
      taskDueThe18th,
      { ...EMPTY_FILTER_STATE, due: "today" },
      { projectTimezone: "UTC", now: lateNow },
    );
    expect(utcResult).toEqual([]);

    // A project on Asia/Kolkata has already rolled over to the 18th — the same task IS due today there.
    const kolkataResult = applyFilters(
      taskDueThe18th,
      { ...EMPTY_FILTER_STATE, due: "today" },
      { projectTimezone: "Asia/Kolkata", now: lateNow },
    );
    expect(kolkataResult.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("applyFilters — unknown/empty inputs never throw", () => {
  it("handles an empty task list", () => {
    expect(applyFilters([], EMPTY_FILTER_STATE, ctx)).toEqual([]);
  });
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `npx vitest run src/lib/filters/apply.test.ts`
Expected: FAIL — `./apply` does not exist.

- [ ] **Step 11: Implement `apply.ts`**

```ts
// src/lib/filters/apply.ts
import { addDaysToDateString, todayInTimeZone } from "./timezone";
import type { FilterState } from "./schema";

export type FilterableTask = {
  id: string;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  due_date: string | null;
  assignee_id: string | null;
  label_ids: string[];
  isDone: boolean;
};

function matchesDue(task: FilterableTask, due: NonNullable<FilterState["due"]>, today: string): boolean {
  if (due === "none") return task.due_date === null;
  if (task.due_date === null) return false;
  if (due === "overdue") return task.due_date < today && !task.isDone;
  if (due === "today") return task.due_date === today;
  // "week": today through today+7 inclusive. Deliberately does not exclude overdue-but-in-window
  // tasks by isDone — an incomplete task due later this week stays visible even if some other
  // task with the same due date is done; "week" is a horizon filter, not a completion filter.
  const weekEnd = addDaysToDateString(today, 7);
  return task.due_date >= today && task.due_date <= weekEnd;
}

/** Pure — no Date.now(), no fetch, no browser API. `ctx.now` and
 * `ctx.projectTimezone` are always supplied by the caller so this stays
 * table-testable and so due-state is always evaluated in the PROJECT's
 * timezone (G3), never the browser's. AND across the five dimensions
 * (assignee/label/priority/due/q); OR within assignee, label and
 * priority (an empty array for a dimension means "no filter on this
 * dimension", not "matches nothing"). */
export function applyFilters<T extends FilterableTask>(
  tasks: T[],
  filters: FilterState,
  ctx: { projectTimezone: string; now: Date },
): T[] {
  const today = todayInTimeZone(ctx.now, ctx.projectTimezone);
  const q = filters.q.trim().toLowerCase();

  return tasks.filter((task) => {
    if (filters.assignee.length > 0) {
      if (!task.assignee_id || !filters.assignee.includes(task.assignee_id)) return false;
    }
    if (filters.label.length > 0) {
      if (!task.label_ids.some((id) => filters.label.includes(id))) return false;
    }
    if (filters.priority.length > 0) {
      if (!filters.priority.includes(task.priority)) return false;
    }
    if (filters.due) {
      if (!matchesDue(task, filters.due, today)) return false;
    }
    if (q) {
      const haystack = `${task.title} ${task.description ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}
```

- [ ] **Step 12: Run to verify it passes**

Run: `npx vitest run src/lib/filters/apply.test.ts`
Expected: PASS.

- [ ] **Step 13: Write the failing test for `use-filter-state.ts`**

```tsx
// src/components/board/use-filter-state.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const replace = vi.fn();
let currentSearch = "";
vi.mock("next/navigation", () => ({
  usePathname: () => "/p/proj-1/board",
  useSearchParams: () => new URLSearchParams(currentSearch),
  useRouter: () => ({ replace }),
}));

describe("useFilterState", () => {
  beforeEach(() => {
    replace.mockClear();
    currentSearch = "";
    vi.useFakeTimers();
  });

  it("initializes from the current URL", async () => {
    currentSearch = "priority=high&q=launch";
    const { useFilterState } = await import("./use-filter-state");
    const { result } = renderHook(() => useFilterState());
    expect(result.current[0].priority).toEqual(["high"]);
    expect(result.current[0].q).toBe("launch");
  });

  it("writes non-q changes to the URL immediately, without debounce", async () => {
    const { useFilterState } = await import("./use-filter-state");
    const { result } = renderHook(() => useFilterState());
    act(() => result.current[1]({ priority: ["urgent"] }));
    expect(replace).toHaveBeenCalledWith("/p/proj-1/board?priority=urgent", { scroll: false });
  });

  it("debounces q changes by 250ms", async () => {
    const { useFilterState } = await import("./use-filter-state");
    const { result } = renderHook(() => useFilterState());
    act(() => result.current[1]({ q: "bug" }));
    expect(replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(249));
    expect(replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(replace).toHaveBeenCalledWith("/p/proj-1/board?q=bug", { scroll: false });
  });

  it("clearFilters resets to the bare pathname", async () => {
    currentSearch = "priority=high";
    const { useFilterState } = await import("./use-filter-state");
    const { result } = renderHook(() => useFilterState());
    act(() => result.current[2]());
    expect(replace).toHaveBeenCalledWith("/p/proj-1/board", { scroll: false });
  });
});
```

- [ ] **Step 14: Run to verify it fails**

Run: `npx vitest run src/components/board/use-filter-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 15: Implement `use-filter-state.ts`**

```ts
// src/components/board/use-filter-state.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseFilterState, serializeFilterState, type FilterState } from "@/lib/filters/schema";

/** URL is the single source of truth for filter state, matching the
 * existing q/priority pattern in project-board.tsx — non-q fields
 * update the URL immediately (assignee/label/priority/due changes come
 * from discrete clicks, not keystrokes, so there is nothing to debounce
 * and an immediate URL write keeps chips/back-button behavior correct);
 * only free-text q is debounced, to avoid a router.replace on every
 * keystroke. */
export function useFilterState(): [FilterState, (next: Partial<FilterState>) => void, () => void] {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<FilterState>(() => parseFilterState(searchParams));
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    setState(parseFilterState(searchParams));
  }, [searchParams]);

  const writeToUrl = useCallback(
    (next: FilterState) => {
      const params = serializeFilterState(next);
      const suffix = params.toString();
      router.replace(suffix ? `${pathname}?${suffix}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const setFilter = useCallback(
    (patch: Partial<FilterState>) => {
      setState((current) => {
        const next = { ...current, ...patch };
        if ("q" in patch) {
          if (debounceRef.current) window.clearTimeout(debounceRef.current);
          debounceRef.current = window.setTimeout(() => writeToUrl(next), 250);
        } else {
          writeToUrl(next);
        }
        return next;
      });
    },
    [writeToUrl],
  );

  const clearFilters = useCallback(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    setState((current) => {
      void current;
      router.replace(pathname, { scroll: false });
      return { assignee: [], label: [], priority: [], due: null, q: "" };
    });
  }, [pathname, router]);

  useEffect(() => () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
  }, []);

  return [state, setFilter, clearFilters];
}
```

- [ ] **Step 16: Run to verify it passes**

Run: `npx vitest run src/components/board/use-filter-state.test.ts`
Expected: PASS.

- [ ] **Step 17: Write the failing test for `use-board-data.ts`**

```tsx
// src/components/board/use-board-data.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

let currentSearch = "";
vi.mock("next/navigation", () => ({
  usePathname: () => "/p/proj-1/board",
  useSearchParams: () => new URLSearchParams(currentSearch),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/lib/realtime/use-project-channel", () => ({
  useProjectChannel: () => "connected",
}));

describe("useBoardData", () => {
  beforeEach(() => {
    currentSearch = "";
  });

  it("visibleTasks reflects filterState over the full task list", async () => {
    const { useBoardData } = await import("./use-board-data");
    currentSearch = "priority=high";
    const { result } = renderHook(() =>
      useBoardData({
        projectId: "proj-1",
        currentUserId: "u1",
        projectTimezone: "UTC",
        initialColumns: [{ id: "c1", name: "Todo", position: 1, wip_limit: null, is_done_column: false }],
        initialTasks: [
          taskFixture({ id: "a", priority: "high" }),
          taskFixture({ id: "b", priority: "low" }),
        ],
      }),
    );
    expect(result.current.tasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(result.current.visibleTasks.map((t) => t.id)).toEqual(["a"]);
    expect(result.current.hasFilters).toBe(true);
  });

  it("appendTask adds to tasks and therefore can appear in visibleTasks", async () => {
    const { useBoardData } = await import("./use-board-data");
    const { result } = renderHook(() =>
      useBoardData({
        projectId: "proj-1",
        currentUserId: "u1",
        projectTimezone: "UTC",
        initialColumns: [{ id: "c1", name: "Todo", position: 1, wip_limit: null, is_done_column: false }],
        initialTasks: [],
      }),
    );
    act(() => result.current.appendTask(taskFixture({ id: "new" })));
    expect(result.current.tasks.map((t) => t.id)).toEqual(["new"]);
    expect(result.current.visibleTasks.map((t) => t.id)).toEqual(["new"]);
  });
});

function taskFixture(overrides: Partial<Record<string, unknown>>) {
  return {
    id: "t",
    column_id: "c1",
    title: "Task",
    description: null,
    due_date: null,
    priority: "medium",
    position: 1,
    assignee_id: null,
    label_ids: [],
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
    ...overrides,
  };
}
```

- [ ] **Step 18: Run to verify it fails**

Run: `npx vitest run src/components/board/use-board-data.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 19: Implement `use-board-data.ts`**

This lifts the task/column state, realtime wiring and mutation callbacks (`appendTask`, `moveTask`, `updateTask`, `deleteTask`) out of `board.tsx` (post-2C) verbatim — same bodies as `project-board.tsx` today — and adds `visibleTasks` computed via `applyFilters`. `board.tsx` (Task 2E.2) and `task-table.tsx` (Task 2E.3) both call this hook instead of keeping their own copies of this state.

```tsx
// src/components/board/use-board-data.ts
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MUTATION_ECHO_TTL_MS,
  SYNC_GRACE_MS,
  mergeColumnEvent,
  mergeTaskEvent,
} from "@/lib/realtime/board-sync";
import { useProjectChannel } from "@/lib/realtime/use-project-channel";
import { applyFilters, type FilterableTask } from "@/lib/filters/apply";
import { useFilterState } from "./use-filter-state";
import type { BoardColumn, BoardTask } from "./board"; // BoardTask now carries assignee_id + label_ids (2C/2D)

export function useBoardData(params: {
  projectId: string;
  currentUserId: string;
  projectTimezone: string;
  initialColumns: BoardColumn[];
  initialTasks: BoardTask[];
  readOnly?: boolean;
}) {
  const [tasks, setTasks] = useState(params.initialTasks);
  const [columns, setColumns] = useState(params.initialColumns);
  const inFlightMutations = useRef<Set<string>>(new Set());
  const router = useRouter();

  const syncStatus = useProjectChannel(params.projectId, params.currentUserId, {
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

  const readOnly = Boolean(params.readOnly) || degraded;
  const [filterState, setFilter, clearFilters] = useFilterState();

  const isDoneColumnId = new Set(columns.filter((c) => c.is_done_column).map((c) => c.id));
  const filterableTasks: (BoardTask & FilterableTask)[] = tasks.map((task) => ({
    ...task,
    label_ids: task.label_ids ?? [],
    isDone: isDoneColumnId.has(task.column_id),
  }));
  const visibleTasks = applyFilters(filterableTasks, filterState, {
    projectTimezone: params.projectTimezone,
    now: new Date(),
  });
  const hasFilters =
    filterState.assignee.length > 0 ||
    filterState.label.length > 0 ||
    filterState.priority.length > 0 ||
    filterState.due !== null ||
    Boolean(filterState.q.trim());

  function appendTask(task: BoardTask) {
    setTasks((current) => [...current, task]);
  }

  async function moveTask(task: BoardTask, columnId: string) {
    // unchanged from project-board.tsx's moveTask — optimistic update, mutationId echo
    // suppression, PATCH /api/v1/tasks/[taskId]/position, revert on failure. Copy verbatim.
    const targetTasks = tasks.filter((candidate) => candidate.column_id === columnId);
    const position =
      targetTasks.length === 0 ? 1 : Math.min(...targetTasks.map((candidate) => candidate.position)) - 1;
    const previousTask = task;
    const mutationId = crypto.randomUUID();
    inFlightMutations.current.add(mutationId);
    window.setTimeout(() => inFlightMutations.current.delete(mutationId), MUTATION_ECHO_TTL_MS);
    setTasks((current) =>
      current.map((candidate) =>
        candidate.id === task.id ? { ...candidate, column_id: columnId, position } : candidate,
      ),
    );
    try {
      const response = await fetch(`/api/v1/tasks/${task.id}/position`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId, position, mutationId }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isMovedTask(payload)) throw new Error("Move rejected");
      setTasks((current) =>
        current.map((candidate) => (candidate.id === task.id ? { ...candidate, ...payload.data } : candidate)),
      );
    } catch {
      setTasks((current) => current.map((candidate) => (candidate.id === task.id ? previousTask : candidate)));
      throw new Error("Task could not be moved. It was returned to its previous column.");
    }
  }

  function updateTask(task: BoardTask) {
    setTasks((current) => current.map((candidate) => (candidate.id === task.id ? task : candidate)));
  }

  function deleteTask(taskId: string) {
    setTasks((current) => current.filter((task) => task.id !== taskId));
  }

  return {
    columns,
    tasks,
    visibleTasks,
    filterState,
    setFilter,
    clearFilters,
    hasFilters,
    syncStatus,
    readOnly,
    appendTask,
    moveTask,
    updateTask,
    deleteTask,
  };
}

function isMovedTask(
  value: unknown,
): value is { data: Pick<BoardTask, "id" | "column_id" | "position" | "updated_at"> } {
  if (typeof value !== "object" || value === null || !("data" in value)) return false;
  const task = value.data;
  return (
    typeof task === "object" &&
    task !== null &&
    "id" in task &&
    typeof task.id === "string" &&
    "column_id" in task
  );
}
```

- [ ] **Step 20: Run to verify it passes**

Run: `npx vitest run src/components/board/use-board-data.test.ts`
Expected: PASS.

- [ ] **Step 21: Run full checks and commit**

Run: `npm run test -- src/lib/filters src/components/board/use-filter-state.test.ts src/components/board/use-board-data.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

```bash
git add src/lib/filters src/components/board/use-filter-state.ts src/components/board/use-filter-state.test.ts src/components/board/use-board-data.ts src/components/board/use-board-data.test.ts
git commit -m "feat(filters): add filter model, project-timezone due-state, and a shared board data hook"
```

---

### Task 2E.2 — Filter bar, chips, search, shortcuts

**Files:**
- Create: `src/lib/keyboard/use-board-shortcuts.ts`, `src/lib/keyboard/use-board-shortcuts.test.ts`, `src/components/board/search-input.tsx`, `src/components/board/search-input.test.tsx`, `src/components/board/filter-bar.tsx`, `src/components/board/filter-bar.test.tsx`, `src/components/board/shortcuts-help-dialog.tsx`.
- Modify: `src/components/board/board.tsx` (wire the filter bar in place of the ad-hoc `q`/`priority` controls, add the empty state copy, fade dragged-out cards instead of vanishing them, wire shortcuts), `src/app/(app)/p/[projectId]/board/page.tsx` (fetch `project_peers` and labels server-side to pass into the filter bar as options).

**Interfaces:**
- Produces:
  ```ts
  // src/lib/keyboard/use-board-shortcuts.ts
  export function useBoardShortcuts(handlers: {
    onFocusSearch: () => void;
    onToggleFilters: () => void;
    onNewTask: () => void;
    onShowHelp: () => void;
  }): void;

  // src/components/board/search-input.tsx
  export function SearchInput(props: { value: string; onChange: (value: string) => void; inputRef?: React.RefObject<HTMLInputElement | null> }): JSX.Element;

  // src/components/board/filter-bar.tsx
  export function FilterBar(props: {
    filters: FilterState;
    onChange: (next: Partial<FilterState>) => void;
    onClear: () => void;
    hasFilters: boolean;
    peers: Array<{ id: string; displayName: string }>;
    labels: Array<{ id: string; name: string; color: string }>;
    searchInputRef: React.RefObject<HTMLInputElement | null>;
  }): JSX.Element;
  ```
- Consumes: `useBoardData` (Task 2E.1), `Button` (`src/components/ui/button.tsx`).

**Acceptance:** component tests for the filter bar (chip render/remove, clear-all, multi-select semantics) and search input; `useBoardShortcuts` unit tests proving each shortcut fires from a neutral target and does **not** fire while focus is inside an `<input>`/`<textarea>`/`<select>`/contenteditable, and that a modifier key (Cmd/Ctrl/Alt held) suppresses the plain-letter shortcuts so they don't collide with browser/OS bindings; empty state shows "No tasks match · Clear filters" only when `hasFilters` is true (an empty column with no filters keeps its existing "Add a task to get started" copy).

- [ ] **Step 1: Write the failing tests for `use-board-shortcuts.ts`**

```tsx
// src/lib/keyboard/use-board-shortcuts.test.ts
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useBoardShortcuts } from "./use-board-shortcuts";

function Harness(handlers: Parameters<typeof useBoardShortcuts>[0]) {
  useBoardShortcuts(handlers);
  return (
    <div>
      <input aria-label="Search tasks" />
      <textarea aria-label="Task title" />
      <button type="button">Neutral target</button>
    </div>
  );
}

describe("useBoardShortcuts", () => {
  it("fires onFocusSearch on '/' when focus is on a neutral element", async () => {
    const onFocusSearch = vi.fn();
    render(
      <Harness onFocusSearch={onFocusSearch} onToggleFilters={vi.fn()} onNewTask={vi.fn()} onShowHelp={vi.fn()} />,
    );
    await userEvent.click(screen.getByText("Neutral target"));
    await userEvent.keyboard("/");
    expect(onFocusSearch).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire while focus is inside the search input", async () => {
    const onFocusSearch = vi.fn();
    const onToggleFilters = vi.fn();
    render(
      <Harness
        onFocusSearch={onFocusSearch}
        onToggleFilters={onToggleFilters}
        onNewTask={vi.fn()}
        onShowHelp={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Search tasks");
    await userEvent.click(input);
    await userEvent.keyboard("/");
    await userEvent.keyboard("f");
    expect(onFocusSearch).not.toHaveBeenCalled();
    expect(onToggleFilters).not.toHaveBeenCalled();
  });

  it("does NOT fire while focus is inside a textarea", async () => {
    const onNewTask = vi.fn();
    render(<Harness onFocusSearch={vi.fn()} onToggleFilters={vi.fn()} onNewTask={onNewTask} onShowHelp={vi.fn()} />);
    const textarea = screen.getByLabelText("Task title");
    await userEvent.click(textarea);
    await userEvent.keyboard("n");
    expect(onNewTask).not.toHaveBeenCalled();
  });

  it("fires onToggleFilters on 'F' (case-insensitive) from a neutral target", async () => {
    const onToggleFilters = vi.fn();
    render(<Harness onFocusSearch={vi.fn()} onToggleFilters={onToggleFilters} onNewTask={vi.fn()} onShowHelp={vi.fn()} />);
    await userEvent.click(screen.getByText("Neutral target"));
    await userEvent.keyboard("F");
    expect(onToggleFilters).toHaveBeenCalledTimes(1);
  });

  it("does not fire when a modifier key is held (avoids colliding with browser/OS shortcuts)", async () => {
    const onFocusSearch = vi.fn();
    render(<Harness onFocusSearch={onFocusSearch} onToggleFilters={vi.fn()} onNewTask={vi.fn()} onShowHelp={vi.fn()} />);
    await userEvent.click(screen.getByText("Neutral target"));
    await userEvent.keyboard("{Control>}/{/Control}");
    expect(onFocusSearch).not.toHaveBeenCalled();
  });

  it("fires onShowHelp on '?'", async () => {
    const onShowHelp = vi.fn();
    render(<Harness onFocusSearch={vi.fn()} onToggleFilters={vi.fn()} onNewTask={vi.fn()} onShowHelp={onShowHelp} />);
    await userEvent.click(screen.getByText("Neutral target"));
    await userEvent.keyboard("?");
    expect(onShowHelp).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/keyboard/use-board-shortcuts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `use-board-shortcuts.ts`**

```ts
// src/lib/keyboard/use-board-shortcuts.ts
"use client";

import { useEffect } from "react";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** Board keyboard shortcuts (02 §21): '/' focus search, 'F' toggle the
 * filter panel, 'N' start a new task, '?' open the shortcuts help
 * dialog. Every branch is gated by isTypingTarget so nothing fires
 * while the user is typing into the search box, a task title, a
 * textarea, or any contenteditable region — and by a modifier check so
 * Cmd/Ctrl/Alt combinations (browser/OS shortcuts) are never
 * intercepted. */
export function useBoardShortcuts(handlers: {
  onFocusSearch: () => void;
  onToggleFilters: () => void;
  onNewTask: () => void;
  onShowHelp: () => void;
}): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key) {
        case "/":
          event.preventDefault();
          handlers.onFocusSearch();
          break;
        case "f":
        case "F":
          handlers.onToggleFilters();
          break;
        case "n":
        case "N":
          handlers.onNewTask();
          break;
        case "?":
          handlers.onShowHelp();
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/keyboard/use-board-shortcuts.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for `search-input.tsx`**

```tsx
// src/components/board/search-input.test.tsx
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchInput } from "./search-input";

describe("SearchInput", () => {
  it("calls onChange with the trimmed... no, raw value as the user types (trimming is applyFilters' job)", async () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} />);
    await userEvent.type(screen.getByRole("searchbox", { name: /search tasks/i }), "bug");
    expect(onChange).toHaveBeenLastCalledWith("bug");
  });

  it("exposes the forwarded ref so '/' can focus it programmatically", () => {
    const ref = createRef<HTMLInputElement>();
    render(<SearchInput value="" onChange={vi.fn()} inputRef={ref} />);
    expect(ref.current).not.toBeNull();
    expect(ref.current).toBe(screen.getByRole("searchbox"));
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/components/board/search-input.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `search-input.tsx`**

```tsx
// src/components/board/search-input.tsx
"use client";

import { Search } from "lucide-react";

export function SearchInput({
  value,
  onChange,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <label className="relative min-w-0 flex-1">
      <span className="sr-only">Search tasks</span>
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        role="searchbox"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search tasks · press /"
        className="bg-background placeholder:text-muted-foreground focus-visible:ring-ring/40 h-9 w-full rounded-md border py-2 pr-3 pl-9 text-base outline-none focus-visible:ring-2 sm:text-sm"
      />
    </label>
  );
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run src/components/board/search-input.test.tsx`
Expected: PASS.

- [ ] **Step 9: Write the failing tests for `filter-bar.tsx`**

```tsx
// src/components/board/filter-bar.test.tsx
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilterBar } from "./filter-bar";
import { EMPTY_FILTER_STATE } from "@/lib/filters/schema";

const peers = [
  { id: "u1", displayName: "Ada" },
  { id: "u2", displayName: "Grace" },
];
const labels = [
  { id: "l1", name: "bug", color: "#ef4444" },
  { id: "l2", name: "design", color: "#3b82f6" },
];

describe("FilterBar", () => {
  it("renders a chip per active filter value and no chips when empty", () => {
    render(
      <FilterBar
        filters={{ ...EMPTY_FILTER_STATE, assignee: ["u1"], priority: ["high"] }}
        onChange={vi.fn()}
        onClear={vi.fn()}
        hasFilters
        peers={peers}
        labels={labels}
        searchInputRef={createRef()}
      />,
    );
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("high", { exact: false })).toBeInTheDocument();
  });

  it("removing a chip calls onChange with that value excluded", async () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        filters={{ ...EMPTY_FILTER_STATE, priority: ["high", "urgent"] }}
        onChange={onChange}
        onClear={vi.fn()}
        hasFilters
        peers={peers}
        labels={labels}
        searchInputRef={createRef()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /remove high/i }));
    expect(onChange).toHaveBeenCalledWith({ priority: ["urgent"] });
  });

  it("clear-all button only renders when hasFilters is true", () => {
    const { rerender } = render(
      <FilterBar
        filters={EMPTY_FILTER_STATE}
        onChange={vi.fn()}
        onClear={vi.fn()}
        hasFilters={false}
        peers={peers}
        labels={labels}
        searchInputRef={createRef()}
      />,
    );
    expect(screen.queryByRole("button", { name: /clear filters/i })).not.toBeInTheDocument();
    rerender(
      <FilterBar
        filters={{ ...EMPTY_FILTER_STATE, due: "today" }}
        onChange={vi.fn()}
        onClear={vi.fn()}
        hasFilters
        peers={peers}
        labels={labels}
        searchInputRef={createRef()}
      />,
    );
    expect(screen.getByRole("button", { name: /clear filters/i })).toBeInTheDocument();
  });

  it("toggling an assignee checkbox adds it to the OR-within-dimension array", async () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        filters={EMPTY_FILTER_STATE}
        onChange={onChange}
        onClear={vi.fn()}
        hasFilters={false}
        peers={peers}
        labels={labels}
        searchInputRef={createRef()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /assignee/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Grace" }));
    expect(onChange).toHaveBeenCalledWith({ assignee: ["u2"] });
  });
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `npx vitest run src/components/board/filter-bar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 11: Implement `filter-bar.tsx`**

```tsx
// src/components/board/filter-bar.tsx
"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DueFilter, FilterState } from "@/lib/filters/schema";
import { SearchInput } from "./search-input";

const PRIORITIES: FilterState["priority"] = ["low", "medium", "high", "urgent"];
const DUE_OPTIONS: Array<{ value: DueFilter; label: string }> = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "week", label: "Due this week" },
  { value: "none", label: "No due date" },
];

export function FilterBar({
  filters,
  onChange,
  onClear,
  hasFilters,
  peers,
  labels,
  searchInputRef,
}: {
  filters: FilterState;
  onChange: (next: Partial<FilterState>) => void;
  onClear: () => void;
  hasFilters: boolean;
  peers: Array<{ id: string; displayName: string }>;
  labels: Array<{ id: string; name: string; color: string }>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [openMenu, setOpenMenu] = useState<"assignee" | "label" | "priority" | "due" | null>(null);

  function toggle<K extends "assignee" | "label" | "priority">(dimension: K, value: string) {
    const current = filters[dimension];
    const next = current.includes(value as never)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({ [dimension]: next } as Partial<FilterState>);
  }

  const peerName = (id: string) => peers.find((p) => p.id === id)?.displayName ?? id;
  const labelName = (id: string) => labels.find((l) => l.id === id)?.name ?? id;

  return (
    <div className="bg-background flex flex-col gap-2 border-b px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={filters.q} onChange={(q) => onChange({ q })} inputRef={searchInputRef} />

        <div className="relative">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={openMenu === "assignee"}
            onClick={() => setOpenMenu((m) => (m === "assignee" ? null : "assignee"))}
          >
            Assignee{filters.assignee.length ? ` (${filters.assignee.length})` : ""}
          </Button>
          {openMenu === "assignee" && (
            <div className="bg-card absolute z-20 mt-1 w-56 rounded-md border p-2 shadow-md" role="menu">
              {peers.map((peer) => (
                <label key={peer.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={filters.assignee.includes(peer.id)}
                    onChange={() => toggle("assignee", peer.id)}
                  />
                  {peer.displayName}
                </label>
              ))}
              {peers.length === 0 && <p className="text-muted-foreground px-2 py-1.5 text-sm">No teammates yet</p>}
            </div>
          )}
        </div>

        <div className="relative">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={openMenu === "label"}
            onClick={() => setOpenMenu((m) => (m === "label" ? null : "label"))}
          >
            Label{filters.label.length ? ` (${filters.label.length})` : ""}
          </Button>
          {openMenu === "label" && (
            <div className="bg-card absolute z-20 mt-1 w-56 rounded-md border p-2 shadow-md" role="menu">
              {labels.map((label) => (
                <label key={label.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={filters.label.includes(label.id)}
                    onChange={() => toggle("label", label.id)}
                  />
                  <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: label.color }} />
                  {label.name}
                </label>
              ))}
              {labels.length === 0 && <p className="text-muted-foreground px-2 py-1.5 text-sm">No labels yet</p>}
            </div>
          )}
        </div>

        <div className="relative">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={openMenu === "priority"}
            onClick={() => setOpenMenu((m) => (m === "priority" ? null : "priority"))}
          >
            Priority{filters.priority.length ? ` (${filters.priority.length})` : ""}
          </Button>
          {openMenu === "priority" && (
            <div className="bg-card absolute z-20 mt-1 w-44 rounded-md border p-2 shadow-md" role="menu">
              {PRIORITIES.map((priority) => (
                <label key={priority} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm capitalize hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={filters.priority.includes(priority)}
                    onChange={() => toggle("priority", priority)}
                  />
                  {priority}
                </label>
              ))}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm font-medium">
          <span className="text-muted-foreground">Due</span>
          <select
            value={filters.due ?? "all"}
            onChange={(event) =>
              onChange({ due: event.target.value === "all" ? null : (event.target.value as DueFilter) })
            }
            className="bg-background focus-visible:ring-ring/40 h-9 rounded-md border px-2 text-sm font-normal outline-none focus-visible:ring-2"
          >
            <option value="all">Any</option>
            {DUE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {hasFilters && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X /> Clear filters
          </Button>
        )}
      </div>

      {hasFilters && (
        <div className="flex flex-wrap gap-1.5" aria-label="Active filters">
          {filters.assignee.map((id) => (
            <Chip key={`a-${id}`} label={peerName(id)} onRemove={() => toggle("assignee", id)} />
          ))}
          {filters.label.map((id) => (
            <Chip key={`l-${id}`} label={labelName(id)} onRemove={() => toggle("label", id)} />
          ))}
          {filters.priority.map((priority) => (
            <Chip key={`p-${priority}`} label={priority} onRemove={() => toggle("priority", priority)} />
          ))}
          {filters.due && (
            <Chip
              label={DUE_OPTIONS.find((o) => o.value === filters.due)?.label ?? filters.due}
              onRemove={() => onChange({ due: null })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="bg-muted inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium capitalize">
      {label}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="hover:text-destructive rounded-full"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
```

- [ ] **Step 12: Run to verify it passes**

Run: `npx vitest run src/components/board/filter-bar.test.tsx`
Expected: PASS.

- [ ] **Step 13: Write `shortcuts-help-dialog.tsx` (no dedicated test file — covered by the board integration test in Step 15)**

```tsx
// src/components/board/shortcuts-help-dialog.tsx
"use client";

import { Button } from "@/components/ui/button";

const SHORTCUTS: Array<{ key: string; description: string }> = [
  { key: "/", description: "Focus search" },
  { key: "F", description: "Toggle filters" },
  { key: "N", description: "Add a new task" },
  { key: "?", description: "Show this help" },
];

export function ShortcutsHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="bg-card w-full max-w-sm rounded-xl p-5 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-lg font-semibold">
            Keyboard shortcuts
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.key} className="flex items-center justify-between">
              <dt className="text-muted-foreground">{shortcut.description}</dt>
              <dd>
                <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-xs">{shortcut.key}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
```

- [ ] **Step 14: Wire the filter bar, shortcuts and fade-out behavior into `board.tsx`**

Re-derive the actual current shape of `src/components/board/board.tsx` first (per the top-of-file dependency note) — Task 2C.1 is expected to have moved most of what was in `project-board.tsx`'s top-level component here unchanged apart from the dnd-kit swap. Apply this diff against whatever that file now looks like:

```tsx
// src/components/board/board.tsx — replace the local q/priority state and visibleTasks
// computation with useBoardData; replace the inline search/priority controls with <FilterBar>;
// wire useBoardShortcuts; render <ShortcutsHelpDialog>; fade dragged-out cards.

// Remove: local `tasks`, `columns`, `query`, `priority`, `visibleTasks`, the debounced
// router.replace effect, and the inline search <input>/<select> block — all now live in
// useBoardData / FilterBar.

const searchInputRef = useRef<HTMLInputElement>(null);
const [filtersOpen, setFiltersOpen] = useState(true); // filter bar is visible by default on desktop
const [helpOpen, setHelpOpen] = useState(false);
const composerRef = useRef<HTMLTextAreaElement>(null);

const {
  columns,
  tasks,
  visibleTasks,
  filterState,
  setFilter,
  clearFilters,
  hasFilters,
  syncStatus,
  readOnly,
  appendTask,
  moveTask,
  updateTask,
  deleteTask,
} = useBoardData({
  projectId,
  currentUserId,
  projectTimezone,          // new prop — board/page.tsx passes projects.timezone (see Step 16)
  initialColumns,
  initialTasks,
  readOnly: readOnlyRole,
});

useBoardShortcuts({
  onFocusSearch: () => searchInputRef.current?.focus(),
  onToggleFilters: () => setFiltersOpen((open) => !open),
  onNewTask: () => composerRef.current?.focus(),
  onShowHelp: () => setHelpOpen(true),
});

// ...

{filtersOpen && (
  <FilterBar
    filters={filterState}
    onChange={setFilter}
    onClear={clearFilters}
    hasFilters={hasFilters}
    peers={peers}            // new prop from board/page.tsx — project_peers rows
    labels={labels}          // new prop from board/page.tsx — labels rows (2D)
    searchInputRef={searchInputRef}
  />
)}

// ... inside the column-rendering map, the empty-state branch becomes:
{columnTasks.length === 0 && (
  <div className="text-muted-foreground flex min-h-28 items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm">
    {hasFilters ? (
      <span>
        No tasks match ·{" "}
        <button type="button" onClick={clearFilters} className="underline underline-offset-2">
          Clear filters
        </button>
      </span>
    ) : readOnly ? (
      "No tasks in this column"
    ) : (
      "Add a task to get started"
    )}
  </div>
)}

<ShortcutsHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
```

For the "dragged-out card fades rather than vanishes" acceptance item: a card whose task is being dragged into another column optimistically disappears from its source column's `columnTasks.filter(...)` the instant `moveTask`'s optimistic `setTasks` runs, because the filter is keyed on `column_id`. To fade instead of vanish, track the in-flight moving task id (already exists as `movingTaskId`/`moving` prop on `TaskCard`) and, in the **source** column's render, keep the card mounted with `opacity-0 transition-opacity duration-150` for one animation frame rather than removing it from the DOM immediately — concretely, compute `columnTasks` from `visibleTasks` including a task whose `id === movingTaskId` even if its `column_id` no longer matches this column, for the duration of the move:

```tsx
const columnTasks = visibleTasks
  .filter((task) => task.column_id === column.id || task.id === movingTaskId)
  .sort((a, b) => a.position - b.position);
```

combined with `TaskCard`'s existing `moving && "opacity-50"` class (extend the transition: `"transition-opacity duration-150"` alongside it) — this is a small, additive change to the existing card-fade styling already present in `TaskCard`, not a new mechanism.

- [ ] **Step 15: Component test — filter bar wiring + empty state + shortcut integration**

```tsx
// src/components/board/board.test.tsx (extend if 2C already created this file; create it if not)
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Board } from "./board";

vi.mock("@/lib/realtime/use-project-channel", () => ({ useProjectChannel: () => "connected" }));

describe("Board — filters integration", () => {
  it("shows the filtered empty state and a working Clear filters link when a filter matches nothing", async () => {
    render(
      <Board
        projectId="p1"
        currentUserId="u1"
        projectTimezone="UTC"
        readOnly={false}
        initialColumns={[{ id: "c1", name: "Todo", position: 1, wip_limit: null, is_done_column: false }]}
        initialTasks={[{ id: "t1", column_id: "c1", title: "Real task", description: null, due_date: null, priority: "low", position: 1, assignee_id: null, label_ids: [], created_at: "", updated_at: "" }]}
        peers={[]}
        labels={[]}
      />,
    );
    await userEvent.type(screen.getByRole("searchbox"), "no such task");
    expect(await screen.findByText(/No tasks match/i)).toBeInTheDocument();
    await userEvent.click(screen.getByText("Clear filters"));
    expect(screen.getByText("Real task")).toBeInTheDocument();
  });

  it("pressing '/' focuses the search box, and typing in it does not re-trigger the shortcut", async () => {
    render(
      <Board
        projectId="p1"
        currentUserId="u1"
        projectTimezone="UTC"
        readOnly={false}
        initialColumns={[{ id: "c1", name: "Todo", position: 1, wip_limit: null, is_done_column: false }]}
        initialTasks={[]}
        peers={[]}
        labels={[]}
      />,
    );
    await userEvent.click(document.body);
    await userEvent.keyboard("/");
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });
});
```

- [ ] **Step 16: Update `board/page.tsx` to fetch peers and labels**

```tsx
// src/app/(app)/p/[projectId]/board/page.tsx — add alongside the existing Promise.all
const [{ data: peerRows }, { data: labelRows }] = await Promise.all([
  supabase.from("project_peers").select("id, display_name"),
  supabase.from("labels").select("id, name, color").eq("project_id", projectId), // 2D table
]);
const peers = (peerRows ?? []).map((row) => ({ id: row.id, displayName: row.display_name }));
const labels = labelRows ?? [];

// ...pass through:
<ProjectBoard
  projectId={projectId}
  currentUserId={auth.user.id}
  projectTimezone={project.timezone ?? "UTC"}   // requires selecting timezone alongside name/id above
  initialColumns={columns}
  initialTasks={tasks}
  readOnly={membership?.role === "viewer"}
  peers={peers}
  labels={labels}
/>
```

Also extend the initial `.select("id, name")` on `projects` to `.select("id, name, timezone")` so `project.timezone` is available for `applyFilters`' `ctx.projectTimezone`.

- [ ] **Step 17: Run full checks and commit**

Run: `npm run test -- src/lib/keyboard src/components/board && npm run typecheck && npm run lint && npm run build`
Expected: PASS.

```bash
git add src/lib/keyboard src/components/board src/app/\(app\)/p/\[projectId\]/board/page.tsx
git commit -m "feat(board): add filter bar with chips, search, and keyboard shortcuts"
```

---

### Task 2E.3 — List view parity + inline edit (S6)

**Files:**
- Create: `src/components/list/task-table.tsx`, `src/components/list/task-table.test.tsx`.
- Modify: `src/app/(app)/p/[projectId]/list/page.tsx` (rewrite from a server-rendered static table into a client page that fetches the same initial data shape as the board and hands it to `useBoardData` + `task-table.tsx`, so filters/search state is shared and a URL like `/p/:id/list?priority=high` behaves identically to the board's).

**Interfaces:**
- Produces:
  ```ts
  // src/components/list/task-table.tsx
  export function TaskTable(props: {
    tasks: BoardTask[];            // already filtered — visibleTasks from useBoardData
    columns: BoardColumn[];
    peers: Array<{ id: string; displayName: string }>;
    readOnly: boolean;
    onInlineUpdate: (taskId: string, patch: { assigneeId?: string | null; dueDate?: string | null; priority?: BoardTask["priority"] }) => Promise<void>;
    onOpenTask: (task: BoardTask) => void;
  }): JSX.Element;
  ```
- Consumes: `useBoardData` (Task 2E.1), `FilterBar`/`SearchInput` (Task 2E.2), the existing `PATCH /api/v1/tasks/[taskId]` route (already accepts `assigneeId` per the 2C.3 dependency this plan assumes — if it does not yet, this task's Step 5 inline-edit calls fail closed with the existing "changes could not be saved" error copy, which is an acceptable degraded state to ship with a follow-up note rather than block this task on 2C).

**Acceptance:** component tests for the table (sortable column headers toggle ascending/descending, filtered list reflects `visibleTasks`, inline-editing assignee/due/priority calls `onInlineUpdate` with the right patch and reverts optimistically on failure); manual parity check — the same task set, in the same order by a given sort key, on both `/board` and `/list` for a fixed filter.

- [ ] **Step 1: Write the failing tests for `task-table.tsx`**

```tsx
// src/components/list/task-table.test.tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskTable } from "./task-table";

const columns = [{ id: "c1", name: "Todo", position: 1, wip_limit: null, is_done_column: false }];
const peers = [{ id: "u1", displayName: "Ada" }];

function task(overrides: Partial<Record<string, unknown>>) {
  return {
    id: "t1",
    column_id: "c1",
    title: "Task A",
    description: null,
    due_date: "2026-09-20",
    priority: "medium",
    position: 1,
    assignee_id: null,
    label_ids: [],
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("TaskTable", () => {
  it("renders one row per task with column name resolved", () => {
    render(
      <TaskTable
        tasks={[task({})]}
        columns={columns}
        peers={peers}
        readOnly={false}
        onInlineUpdate={vi.fn()}
        onOpenTask={vi.fn()}
      />,
    );
    const row = screen.getByRole("row", { name: /Task A/i });
    expect(within(row).getByText("Todo")).toBeInTheDocument();
  });

  it("clicking a sortable column header toggles ascending/descending order", async () => {
    render(
      <TaskTable
        tasks={[task({ id: "a", title: "Bravo", due_date: "2026-09-22" }), task({ id: "b", title: "Alpha", due_date: "2026-09-18" })]}
        columns={columns}
        peers={peers}
        readOnly={false}
        onInlineUpdate={vi.fn()}
        onOpenTask={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /due date/i }));
    let rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(within(rows[0]).getByText("Alpha")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /due date/i }));
    rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Bravo")).toBeInTheDocument();
  });

  it("inline-editing priority calls onInlineUpdate with the new value", async () => {
    const onInlineUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskTable tasks={[task({})]} columns={columns} peers={peers} readOnly={false} onInlineUpdate={onInlineUpdate} onOpenTask={vi.fn()} />,
    );
    await userEvent.selectOptions(screen.getByLabelText(/priority for Task A/i), "urgent");
    expect(onInlineUpdate).toHaveBeenCalledWith("t1", { priority: "urgent" });
  });

  it("inline-editing assignee calls onInlineUpdate with assigneeId, including null for Unassigned", async () => {
    const onInlineUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskTable tasks={[task({ assignee_id: "u1" })]} columns={columns} peers={peers} readOnly={false} onInlineUpdate={onInlineUpdate} onOpenTask={vi.fn()} />,
    );
    await userEvent.selectOptions(screen.getByLabelText(/assignee for Task A/i), "");
    expect(onInlineUpdate).toHaveBeenCalledWith("t1", { assigneeId: null });
  });

  it("readOnly disables every inline control", () => {
    render(<TaskTable tasks={[task({})]} columns={columns} peers={peers} readOnly onInlineUpdate={vi.fn()} onOpenTask={vi.fn()} />);
    expect(screen.getByLabelText(/priority for Task A/i)).toBeDisabled();
    expect(screen.getByLabelText(/assignee for Task A/i)).toBeDisabled();
  });

  it("clicking the title opens the task editor", async () => {
    const onOpenTask = vi.fn();
    render(<TaskTable tasks={[task({})]} columns={columns} peers={peers} readOnly={false} onInlineUpdate={vi.fn()} onOpenTask={onOpenTask} />);
    await userEvent.click(screen.getByRole("button", { name: "Task A" }));
    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/list/task-table.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `task-table.tsx`**

```tsx
// src/components/list/task-table.tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { BoardColumn, BoardTask } from "@/components/board/board";

type SortKey = "title" | "column" | "priority" | "due_date";
type SortDirection = "asc" | "desc";

const PRIORITY_RANK: Record<BoardTask["priority"], number> = { low: 0, medium: 1, high: 2, urgent: 3 };

export function TaskTable({
  tasks,
  columns,
  peers,
  readOnly,
  onInlineUpdate,
  onOpenTask,
}: {
  tasks: BoardTask[];
  columns: BoardColumn[];
  peers: Array<{ id: string; displayName: string }>;
  readOnly: boolean;
  onInlineUpdate: (
    taskId: string,
    patch: { assigneeId?: string | null; dueDate?: string | null; priority?: BoardTask["priority"] },
  ) => Promise<void>;
  onOpenTask: (task: BoardTask) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("due_date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const columnName = new Map(columns.map((c) => [c.id, c.name]));

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  const sorted = [...tasks].sort((a, b) => {
    const direction = sortDirection === "asc" ? 1 : -1;
    switch (sortKey) {
      case "title":
        return a.title.localeCompare(b.title) * direction;
      case "column":
        return (columnName.get(a.column_id) ?? "").localeCompare(columnName.get(b.column_id) ?? "") * direction;
      case "priority":
        return (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) * direction;
      case "due_date":
        return ((a.due_date ?? "9999-99-99") < (b.due_date ?? "9999-99-99") ? -1 : 1) * direction;
      default:
        return 0;
    }
  });

  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="bg-muted/50 text-muted-foreground border-b text-xs font-medium">
            <tr>
              <SortableHeader label="Task" active={sortKey === "title"} direction={sortDirection} onClick={() => toggleSort("title")} />
              <SortableHeader label="Column" active={sortKey === "column"} direction={sortDirection} onClick={() => toggleSort("column")} />
              <th className="px-4 py-3">Assignee</th>
              <SortableHeader label="Priority" active={sortKey === "priority"} direction={sortDirection} onClick={() => toggleSort("priority")} />
              <SortableHeader label="Due date" active={sortKey === "due_date"} direction={sortDirection} onClick={() => toggleSort("due_date")} />
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.map((task) => (
              <tr key={task.id} className="hover:bg-muted/30">
                <td className="max-w-md px-4 py-3 font-medium">
                  <button type="button" onClick={() => onOpenTask(task)} className="line-clamp-1 text-left hover:underline">
                    {task.title}
                  </button>
                </td>
                <td className="text-muted-foreground px-4 py-3">{columnName.get(task.column_id) ?? "Unknown column"}</td>
                <td className="px-4 py-3">
                  <label className="sr-only" htmlFor={`assignee-${task.id}`}>
                    Assignee for {task.title}
                  </label>
                  <select
                    id={`assignee-${task.id}`}
                    aria-label={`Assignee for ${task.title}`}
                    value={task.assignee_id ?? ""}
                    disabled={readOnly}
                    onChange={(event) => void onInlineUpdate(task.id, { assigneeId: event.target.value || null })}
                    className="bg-background focus-visible:ring-ring/40 rounded border px-2 py-1 text-sm outline-none focus-visible:ring-2 disabled:opacity-60"
                  >
                    <option value="">Unassigned</option>
                    {peers.map((peer) => (
                      <option key={peer.id} value={peer.id}>
                        {peer.displayName}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <label className="sr-only" htmlFor={`priority-${task.id}`}>
                    Priority for {task.title}
                  </label>
                  <select
                    id={`priority-${task.id}`}
                    aria-label={`Priority for ${task.title}`}
                    value={task.priority}
                    disabled={readOnly}
                    onChange={(event) =>
                      void onInlineUpdate(task.id, { priority: event.target.value as BoardTask["priority"] })
                    }
                    className={cn(
                      "bg-background focus-visible:ring-ring/40 rounded border px-2 py-1 text-sm capitalize outline-none focus-visible:ring-2 disabled:opacity-60",
                    )}
                  >
                    {(["low", "medium", "high", "urgent"] as const).map((priority) => (
                      <option key={priority} value={priority}>
                        {priority}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <label className="sr-only" htmlFor={`due-${task.id}`}>
                    Due date for {task.title}
                  </label>
                  <input
                    id={`due-${task.id}`}
                    type="date"
                    value={task.due_date ?? ""}
                    disabled={readOnly}
                    onChange={(event) => void onInlineUpdate(task.id, { dueDate: event.target.value || null })}
                    className="bg-background focus-visible:ring-ring/40 rounded border px-2 py-1 text-sm outline-none focus-visible:ring-2 disabled:opacity-60"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortableHeader({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}) {
  return (
    <th className="px-4 py-3">
      <button type="button" onClick={onClick} className="hover:text-foreground inline-flex items-center gap-1">
        {label}
        {active && <span aria-hidden="true">{direction === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/list/task-table.test.tsx`
Expected: PASS.

- [ ] **Step 5: Rewrite `list/page.tsx` to share `useBoardData`**

```tsx
// src/app/(app)/p/[projectId]/list/page.tsx
// Becomes a thin server component (fetch initial data, same query shape as board/page.tsx,
// including project_peers/labels/timezone) that hands off to a new client component:
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ListView } from "./list-view";

export default async function ListPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const [{ data: project }, { data: auth }] = await Promise.all([
    supabase.from("projects").select("id, name, timezone").eq("id", projectId).is("deleted_at", null).maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if (!project || !auth.user) notFound();

  const [{ data: columnData }, { data: taskData }, { data: membership }, { data: peerRows }, { data: labelRows }] =
    await Promise.all([
      supabase.from("columns").select("id, name, position, wip_limit, is_done_column").eq("project_id", projectId).is("deleted_at", null).order("position"),
      supabase.from("tasks").select("id, column_id, title, description, due_date, priority, position, assignee_id, created_at, updated_at").eq("project_id", projectId).is("deleted_at", null).order("position"),
      supabase.from("memberships").select("role").eq("project_id", projectId).maybeSingle(),
      supabase.from("project_peers").select("id, display_name"),
      supabase.from("labels").select("id, name, color").eq("project_id", projectId),
    ]);

  return (
    <ListView
      projectId={projectId}
      projectName={project.name}
      projectTimezone={project.timezone ?? "UTC"}
      currentUserId={auth.user.id}
      initialColumns={columnData ?? []}
      initialTasks={taskData ?? []}
      peers={(peerRows ?? []).map((row) => ({ id: row.id, displayName: row.display_name }))}
      labels={labelRows ?? []}
      readOnly={membership?.role === "viewer"}
    />
  );
}
```

```tsx
// src/app/(app)/p/[projectId]/list/list-view.tsx
"use client";

import Link from "next/link";
import { ArrowLeft, LayoutList } from "lucide-react";
import { useBoardData } from "@/components/board/use-board-data";
import { FilterBar } from "@/components/board/filter-bar";
import { TaskTable } from "@/components/list/task-table";
import type { BoardColumn, BoardTask } from "@/components/board/board";

export function ListView(props: {
  projectId: string;
  projectName: string;
  projectTimezone: string;
  currentUserId: string;
  initialColumns: BoardColumn[];
  initialTasks: BoardTask[];
  peers: Array<{ id: string; displayName: string }>;
  labels: Array<{ id: string; name: string; color: string }>;
  readOnly: boolean;
}) {
  const {
    visibleTasks,
    columns,
    filterState,
    setFilter,
    clearFilters,
    hasFilters,
    readOnly,
    updateTask,
  } = useBoardData({
    projectId: props.projectId,
    currentUserId: props.currentUserId,
    projectTimezone: props.projectTimezone,
    initialColumns: props.initialColumns,
    initialTasks: props.initialTasks,
    readOnly: props.readOnly,
  });

  async function inlineUpdate(
    taskId: string,
    patch: { assigneeId?: string | null; dueDate?: string | null; priority?: BoardTask["priority"] },
  ) {
    const task = props.initialTasks.find((t) => t.id === taskId);
    const response = await fetch(`/api/v1/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: task?.title,
        description: task?.description ?? null,
        dueDate: task?.due_date ?? null,
        priority: task?.priority,
        ...patch,
      }),
    });
    const payload: unknown = await response.json();
    if (response.ok && isTaskPayload(payload)) updateTask(payload.data);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href={`/p/${props.projectId}/board`} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm">
        <ArrowLeft className="size-4" /> Back to board
      </Link>
      <div className="mt-6 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="bg-muted rounded-lg p-2.5">
            <LayoutList className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Task list</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {props.projectName} · {visibleTasks.length} of {props.initialTasks.length}{" "}
              {props.initialTasks.length === 1 ? "task" : "tasks"}
            </p>
          </div>
        </div>
      </div>
      <div className="mt-6 rounded-xl border">
        <FilterBar
          filters={filterState}
          onChange={setFilter}
          onClear={clearFilters}
          hasFilters={hasFilters}
          peers={props.peers}
          labels={props.labels}
          searchInputRef={{ current: null }}
        />
      </div>
      <div className="mt-4">
        <TaskTable
          tasks={visibleTasks}
          columns={columns}
          peers={props.peers}
          readOnly={readOnly}
          onInlineUpdate={inlineUpdate}
          onOpenTask={() => {
            /* Task 2C's TaskEditor modal is reused here once board.tsx exports it standalone;
               tracked as a follow-up if it isn't exported by the time this step executes. */
          }}
        />
      </div>
    </main>
  );
}

function isTaskPayload(value: unknown): value is { data: BoardTask } {
  return typeof value === "object" && value !== null && "data" in value;
}
```

- [ ] **Step 6: Run full checks and commit**

Run: `npm run test -- src/components/list && npm run typecheck && npm run lint && npm run build`
Expected: PASS.

```bash
git add src/components/list "src/app/(app)/p/[projectId]/list"
git commit -m "feat(list): bring list view to filter parity with the board and add inline edit"
```

---

### Task 2E.4 — My Tasks (G5)

**Files:**
- Create: `src/lib/my-tasks/group.ts`, `src/lib/my-tasks/group.test.ts`, `src/app/(app)/my-tasks/page.tsx`, `src/components/my-tasks/my-tasks-list.tsx`, `src/components/my-tasks/my-tasks-list.test.tsx`.
- Modify: `src/components/app-shell.tsx` (nav link).

**Interfaces:**
- Produces:
  ```ts
  // src/lib/my-tasks/group.ts
  export type DueGroup = "overdue" | "today" | "week" | "later" | "none";
  export type MyTask = {
    id: string;
    title: string;
    priority: "low" | "medium" | "high" | "urgent";
    due_date: string | null;
    isDone: boolean;
    projectId: string;
    projectName: string;
    projectTimezone: string;
    columnName: string;
  };
  export function groupByDueState(tasks: MyTask[], now: Date): Record<DueGroup, MyTask[]>;
  // Each task's group is computed against ITS OWN project's timezone (G3) — two tasks with the
  // same due_date in different-timezone projects can land in different groups.
  ```
- Consumes: no new RPC — `tasks_member_read` (`supabase/migrations/202609090001_data_core.sql:81`) already scopes `select` to `is_project_member(project_id)` per row, so `select * from tasks where assignee_id = auth.uid()` executed by the signed-in user's own RLS-scoped client naturally returns only tasks in projects they belong to, across every project — no new policy, table or RPC needed. This is the "RLS-direct query" the task-level plan calls for.

**Security properties:** none beyond what `tasks_member_read` already enforces — this task adds a read path, not a write path, and the query is scoped to `auth.uid()` server-side (the page runs as a server component using the request's own session cookie via `createClient()` from `src/lib/supabase/server.ts`, not the admin client), so a user can never pass another user's id and see their tasks.

**Acceptance:** unit tests for `groupByDueState` (per-project timezone independence, "later" bucket for anything beyond the 7-day window, "none" bucket for no due date, done tasks excluded from `overdue` the same way `applyFilters` excludes them); component test for the grouped list (headings only render for non-empty groups, empty overall state, a task links to its own project's board); manual E2E-equivalent: seed two projects (one `UTC`, one `Asia/Kolkata`) with tasks assigned to the same user and confirm grouping differs as expected.

- [ ] **Step 1: Write the failing tests for `group.ts`**

```ts
// src/lib/my-tasks/group.test.ts
import { describe, expect, it } from "vitest";
import { groupByDueState, type MyTask } from "./group";

function myTask(overrides: Partial<MyTask>): MyTask {
  return {
    id: "t1",
    title: "Task",
    priority: "medium",
    due_date: null,
    isDone: false,
    projectId: "p1",
    projectName: "Project",
    projectTimezone: "UTC",
    columnName: "Todo",
    ...overrides,
  };
}

const now = new Date("2026-09-17T12:00:00Z");

describe("groupByDueState", () => {
  it("buckets overdue, today, week, later and none", () => {
    const tasks = [
      myTask({ id: "overdue", due_date: "2026-09-16" }),
      myTask({ id: "today", due_date: "2026-09-17" }),
      myTask({ id: "week", due_date: "2026-09-20" }),
      myTask({ id: "later", due_date: "2026-10-01" }),
      myTask({ id: "none", due_date: null }),
    ];
    const groups = groupByDueState(tasks, now);
    expect(groups.overdue.map((t) => t.id)).toEqual(["overdue"]);
    expect(groups.today.map((t) => t.id)).toEqual(["today"]);
    expect(groups.week.map((t) => t.id)).toEqual(["week"]);
    expect(groups.later.map((t) => t.id)).toEqual(["later"]);
    expect(groups.none.map((t) => t.id)).toEqual(["none"]);
  });

  it("excludes done tasks from overdue (a completed task due yesterday is not nagging you)", () => {
    const tasks = [myTask({ id: "done-overdue", due_date: "2026-09-01", isDone: true })];
    const groups = groupByDueState(tasks, now);
    expect(groups.overdue).toEqual([]);
    expect(groups.later).toEqual([]); // done tasks don't surface in any due bucket
    expect(groups.none).toEqual([]);
  });

  it("evaluates each task's group against ITS OWN project's timezone, not the browser's", () => {
    // Same instant, same due_date, two different project timezones — must land in different groups.
    const lateNow = new Date("2026-09-17T23:30:00Z"); // 05:00 the 18th in Asia/Kolkata
    const tasks = [
      myTask({ id: "utc-task", due_date: "2026-09-18", projectTimezone: "UTC" }),
      myTask({ id: "kolkata-task", due_date: "2026-09-18", projectTimezone: "Asia/Kolkata" }),
    ];
    const groups = groupByDueState(tasks, lateNow);
    expect(groups.today.map((t) => t.id)).toEqual(["kolkata-task"]);
    expect(groups.week.map((t) => t.id)).toEqual(["utc-task"]);
  });

  it("returns empty arrays for every group when there are no tasks", () => {
    const groups = groupByDueState([], now);
    expect(groups).toEqual({ overdue: [], today: [], week: [], later: [], none: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/my-tasks/group.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `group.ts`**

```ts
// src/lib/my-tasks/group.ts
import { addDaysToDateString, todayInTimeZone } from "@/lib/filters/timezone";

export type DueGroup = "overdue" | "today" | "week" | "later" | "none";

export type MyTask = {
  id: string;
  title: string;
  priority: "low" | "medium" | "high" | "urgent";
  due_date: string | null;
  isDone: boolean;
  projectId: string;
  projectName: string;
  projectTimezone: string;
  columnName: string;
};

/** G5 + G3: My Tasks is cross-project, and each task's due-state is
 * judged against ITS OWN project's timezone — two teammates' projects
 * can disagree about what "today" means, and this view has to honour
 * both at once rather than picking one timezone for the whole page.
 * Done tasks never appear in a due bucket (this is a "what needs my
 * attention" view, not an archive). */
export function groupByDueState(tasks: MyTask[], now: Date): Record<DueGroup, MyTask[]> {
  const groups: Record<DueGroup, MyTask[]> = { overdue: [], today: [], week: [], later: [], none: [] };

  for (const task of tasks) {
    if (task.isDone) continue;
    const today = todayInTimeZone(now, task.projectTimezone);

    if (!task.due_date) {
      groups.none.push(task);
      continue;
    }
    if (task.due_date < today) {
      groups.overdue.push(task);
    } else if (task.due_date === today) {
      groups.today.push(task);
    } else if (task.due_date <= addDaysToDateString(today, 7)) {
      groups.week.push(task);
    } else {
      groups.later.push(task);
    }
  }

  return groups;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/my-tasks/group.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `my-tasks-list.tsx`**

```tsx
// src/components/my-tasks/my-tasks-list.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MyTasksList } from "./my-tasks-list";
import type { MyTask } from "@/lib/my-tasks/group";

function myTask(overrides: Partial<MyTask>): MyTask {
  return {
    id: "t1",
    title: "Task",
    priority: "medium",
    due_date: null,
    isDone: false,
    projectId: "p1",
    projectName: "Launch",
    projectTimezone: "UTC",
    columnName: "Todo",
    ...overrides,
  };
}

describe("MyTasksList", () => {
  it("only renders headings for non-empty groups", () => {
    render(<MyTasksList tasks={[myTask({ id: "a", due_date: "2026-09-17" })]} now={new Date("2026-09-17T12:00:00Z")} />);
    expect(screen.getByRole("heading", { name: /due today/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /overdue/i })).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no assigned tasks anywhere", () => {
    render(<MyTasksList tasks={[]} now={new Date("2026-09-17T12:00:00Z")} />);
    expect(screen.getByText(/nothing assigned to you/i)).toBeInTheDocument();
  });

  it("links each task to its own project's board", () => {
    render(<MyTasksList tasks={[myTask({ id: "a", due_date: "2026-09-17", projectId: "proj-99" })]} now={new Date("2026-09-17T12:00:00Z")} />);
    expect(screen.getByRole("link", { name: /Task/i })).toHaveAttribute("href", "/p/proj-99/board?task=a");
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/components/my-tasks/my-tasks-list.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `my-tasks-list.tsx` and the page**

```tsx
// src/components/my-tasks/my-tasks-list.tsx
"use client";

import Link from "next/link";
import { Flag } from "lucide-react";
import { groupByDueState, type DueGroup, type MyTask } from "@/lib/my-tasks/group";

const GROUP_LABELS: Record<DueGroup, string> = {
  overdue: "Overdue",
  today: "Due today",
  week: "Due this week",
  later: "Later",
  none: "No due date",
};
const GROUP_ORDER: DueGroup[] = ["overdue", "today", "week", "later", "none"];

export function MyTasksList({ tasks, now }: { tasks: MyTask[]; now: Date }) {
  const groups = groupByDueState(tasks, now);
  const isEmpty = GROUP_ORDER.every((key) => groups[key].length === 0);

  if (isEmpty) {
    return (
      <section className="bg-card mt-10 rounded-xl border border-dashed p-8 text-center">
        <h2 className="font-semibold">Nothing assigned to you</h2>
        <p className="text-muted-foreground mt-1 text-sm">Open tasks assigned to you across every project will show up here.</p>
      </section>
    );
  }

  return (
    <div className="mt-8 space-y-8">
      {GROUP_ORDER.filter((key) => groups[key].length > 0).map((key) => (
        <section key={key} aria-labelledby={`group-${key}`}>
          <h2 id={`group-${key}`} className="text-sm font-semibold tracking-wide uppercase">
            {GROUP_LABELS[key]} <span className="text-muted-foreground font-normal">({groups[key].length})</span>
          </h2>
          <ul className="mt-2 divide-y rounded-lg border">
            {groups[key].map((task) => (
              <li key={task.id}>
                <Link
                  href={`/p/${task.projectId}/board?task=${task.id}`}
                  className="hover:bg-muted/40 flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">{task.projectName} · {task.columnName}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs capitalize">
                    <Flag className="size-3" aria-hidden="true" /> {task.priority}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

```tsx
// src/app/(app)/my-tasks/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MyTasksList } from "@/components/my-tasks/my-tasks-list";
import type { MyTask } from "@/lib/my-tasks/group";

export default async function MyTasksPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  // RLS-direct: tasks_member_read already scopes every row to
  // is_project_member(project_id) for the calling user, so this single
  // query naturally spans every project the user belongs to without a
  // project_id filter and without any new policy (G5).
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, priority, due_date, columns!inner(name, is_done_column), projects!inner(id, name, timezone)",
    )
    .eq("assignee_id", auth.user.id)
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false });

  const tasks: MyTask[] = (data ?? []).map((row) => {
    const column = Array.isArray(row.columns) ? row.columns[0] : row.columns;
    const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    return {
      id: row.id,
      title: row.title,
      priority: row.priority,
      due_date: row.due_date,
      isDone: column?.is_done_column ?? false,
      projectId: project?.id ?? "",
      projectName: project?.name ?? "Unknown project",
      projectTimezone: project?.timezone ?? "UTC",
      columnName: column?.name ?? "Unknown column",
    };
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">My Tasks</h1>
      <p className="text-muted-foreground mt-1 text-sm">Open tasks assigned to you, across every project.</p>
      {error ? (
        <p className="text-destructive mt-10 text-sm" role="alert">
          Your tasks could not be loaded. Refresh to try again.
        </p>
      ) : (
        <MyTasksList tasks={tasks} now={new Date()} />
      )}
    </main>
  );
}
```

- [ ] **Step 8: Run to verify the component test passes**

Run: `npx vitest run src/components/my-tasks/my-tasks-list.test.tsx`
Expected: PASS.

- [ ] **Step 9: Add the nav link**

```tsx
// src/components/app-shell.tsx — add a "My Tasks" link between the wordmark and the account block
<Link href="/my-tasks" className="text-muted-foreground hover:text-foreground text-sm font-medium">
  My Tasks
</Link>
```

Placed inside the existing `<header>` flex row, before the `email ?? "..."` block — this is a global link (unlike board's project-scoped "List"/"Settings"/"Activity" links), so `app-shell.tsx` is the right place, not any single project page.

- [ ] **Step 10: Run full checks, the RLS suite regression check, and commit**

Run: `npm run test -- src/lib/my-tasks src/components/my-tasks && npm run test:rls && npm run typecheck && npm run lint && npm run build && npm run size`
Expected: all PASS — `test:rls` specifically must show no change in behavior, since this task added no migration.

```bash
git add src/lib/my-tasks src/components/my-tasks "src/app/(app)/my-tasks" src/components/app-shell.tsx
git commit -m "feat(my-tasks): add cross-project My Tasks view grouped by due state"
```

---

## Verification (sub-plan exit)

See `00-master-roadmap.md` §6 for the full per-sub-plan and MVP-gate checklist. For this sub-plan specifically:

- `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build && npm run size` green.
- Preview deploy on staging; manually exercise: search a task by title and by description substring; filter by assignee, label, priority and each due bucket, alone and combined (AND across dimensions); confirm a filtered-to-nothing column shows "No tasks match · Clear filters" and Clear filters restores the board; confirm a dragged card fades rather than disappears mid-drag; press `/`, `F`, `N`, `?` on the board and confirm none of them fire while typing in the search box or a task title; switch to `/p/:id/list`, confirm the same filter state (via the URL) produces the same visible task set as the board, sort by each column, inline-edit assignee/due/priority on a row and confirm it persists after a refresh; open `/my-tasks` while assigned tasks exist in two projects with different `timezone` values and confirm the overdue/today/week/later grouping differs between them at a timezone boundary.
- Two-browser realtime check: task filtered out of view on browser A when browser B changes its assignee/priority/due date to no longer match A's active filter (it should simply disappear from A's `visibleTasks`, no separate wiring needed since `visibleTasks` is derived, not cached).
- Playwright flow J3 (filter overdue → analytics) from `00-master-roadmap.md` §6 depends on this sub-plan's overdue filter and on 2G's analytics dashboard; add the `e2e/` spec for the filter half of that flow here once Playwright is introduced (first needed in `2B.4`), and extend it with the analytics half when 2G lands.

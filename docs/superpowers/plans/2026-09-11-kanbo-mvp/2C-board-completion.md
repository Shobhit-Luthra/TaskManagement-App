# Kanbo Sub-plan 2C — Board completion (P0)

> **Status: task-level.** Expand this file to step-level (bite-sized TDD steps with code) using `superpowers:writing-plans` immediately before execution, then run it with `superpowers:subagent-driven-development`. Do not start until Sub-plan 2B has shipped to staging with CI green.
>
> **Read first:** `00-master-roadmap.md` §2 (Gap Register — the G*/T* ids referenced below), §4 (cross-cutting rules, including the security-property requirement for auth/membership/token tasks), and the *Interfaces* blocks of the previous sub-plans — every task here consumes `withApiHandler` / `mapRpcError` (`src/lib/api/handler.ts`), `RATE_LIMITS` (`src/lib/api/rate-limit.ts`), `createAdminClient` (`src/lib/supabase/admin.ts`), `seedIsolationFixture` (`src/test/rls/setup.ts`) and `log` (`src/lib/log.ts`) from 2A.
>
> **Commit rule:** Conventional Commits, no AI co-author or session trailers.

**Spec:** `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md` + `docs/specs/00`–`07`; `00-master-roadmap.md` §5 Sub-plan 2C.

**Definition of done:** every task's acceptance tests green; new tables covered by the RLS isolation suite; `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build && npm run size` green; preview deployment on staging exercised manually; CI green on the PR.

---

## Tasks

**Task 2C.1 — dnd-kit migration with keyboard DnD (T11)**
- Files: split `project-board.tsx` (962 lines) into `board/board.tsx`, `board/column.tsx`, `board/task-card.tsx`, `board/task-editor.tsx`, `board/use-board-dnd.ts`, `board/announcer.tsx`; add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`.
- Produces: `computeDropPosition(prev: number | null, next: number | null): number` (pure, `04 §9` rules), `useBoardDnd({ onMove(taskId, columnId, position, mutationId) })`.
- Acceptance: unit tests for `computeDropPosition` (between/top/bottom/empty); keyboard test with Testing Library: Space lifts, ArrowRight moves to next column, Space drops → `onMove` called; live region announces once per batch (throttled 1 s); `prefers-reduced-motion` disables transitions; E2E mouse drag persists after reload.

**Task 2C.2 — Renormalisation (`04 §9`)**
- Files: migration: `move_task` detects `p_position = prev or next` → calls `renormalize_column(p_column_id)` and returns canonical positions; `renormalize_positions()` nightly `pg_cron` job (`03 §13`, min gap < 1e-6); `job_runs` table (T1).
- Acceptance: SQL integration test — 60 consecutive top inserts never collide; board reconciles returned positions.

**Task 2C.3 — Assignee, priority, due date on card + editor**
- Files: `board/assignee-picker.tsx` (uses `project_peers`), card avatar, `update_task` RPC extended to validate assignee is a current member (BR-5) and write `assigned/unassigned` activity.
- Acceptance: non-member assignee → 422; card shows avatar + initials; no colour-only priority (icon + label).

**Task 2C.4 — Optimistic concurrency (`05 §2`)**
- Files: `update_task(p_expected_updated_at)` → raise `CONFLICT` (errcode `40001` mapped → 409 with current row); editor shows conflict banner with "Reload" / "Overwrite".
- Acceptance: two clients edit → second gets 409 with server copy.

**Task 2C.5 — Task restore + trash**
- Files: migration `restore_task` (410 if `deleted_at` older than 30 days or purged), route `POST /api/v1/tasks/[taskId]/restore`, `src/app/(app)/p/[projectId]/trash/page.tsx` (Owner/Admin/Member), RLS policy `tasks_member_read_deleted` for the trash view (members can read their project's deleted rows for 30 days).
- Acceptance: delete → appears in trash → restore → back on board with `restored` activity.

**Task 2C.6 — Column reorder, delete-with-choice, WIP indicator**
- Files: migration `move_column`, `delete_column(p_column_id, p_move_tasks_to uuid | null)` (null = soft-delete its tasks; else move them, in one txn; refuse to delete the only column or the done column while it holds tasks and no target), routes; dnd-kit sortable on column headers; delete dialog with the two choices; WIP count `n/limit` badge turns warning colour + icon at limit (no colour-only).
- Acceptance: drop into a column deleted mid-drag → 422 → card reverts + toast (`01 §23`).

**Task 2C.7 — Unsaved-create retry, deep link, card counts**
- Files: composer keeps failed cards locally with "Unsaved · Retry" (S1); `?task=` opens editor (G14); board query adds `subtasks(count)` progress `2/5`.
- Acceptance: simulated network failure keeps the card; deep link opens the modal; counts correct.

---

---

## Verification (sub-plan exit)

See `00-master-roadmap.md` §6. Playwright flows relevant to this sub-plan are listed there; add the ones this sub-plan enables to `e2e/` when Playwright is introduced (first needed in 2B.4).

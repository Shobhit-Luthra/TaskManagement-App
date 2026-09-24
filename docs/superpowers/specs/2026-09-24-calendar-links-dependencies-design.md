# Phase 3 design: Calendar, Task Links, Dependencies

Date: 2026-09-24 · Status: approved in brainstorming, awaiting written-spec review

## Context
The user asked for a set of task-collaboration features. An inventory of the repo showed that several already ship: comments with markdown, @mentions that feed notifications, subtasks as a checklist, task descriptions, the task-detail drawer, a project Timeline list, and a cross-project My Tasks page. The user confirmed that the task-detail and description work is already done, and chose to keep subtasks as a checklist.

Three gaps remain. The PRD (`docs/specs/01_prd.md`) had deferred all three to Phase 2, so this work brings them forward:
- **3A:** a month/week **Calendar** (tasks placed by due date) for a single project and for the current user.
- **3B:** **Task links**. The user dropped file uploads in favour of named URLs "for now".
- **3C:** **Dependencies** ("B can't start until A is done") that warn but don't block.

Binding constraints from memory:
- Business logic lives in security-definer plpgsql RPCs, with thin route handlers that share one helper.
- Free tier only.
- No Docker.
- No AI trailers on commits.

## Design

### Shared conventions
- Put new SQL in timestamped migrations after `202610010001_project_timeline.sql`.
- Access checks use `is_project_member` and `can_write_project` (from `202609090001_data_core.sql`).
- Route handlers go under `src/app/api/v1/...` and use the shared handler helper.
- Tests: Vitest unit tests (`npm test`) and RLS integration tests (`npm run test:rls`, pattern `src/test/rls/timeline.test.ts`).
- No new npm dependencies.

### 3A Calendar
**RPC `calendar_tasks(p_project_id uuid default null, p_from date, p_to date)`**
- With a project id, it checks `is_project_member` and returns that project's non-deleted tasks with `due_date` between `p_from` and `p_to`.
- With a null project id, it returns tasks assigned to `auth.uid()` in every project where the caller is a member.
- A range longer than 42 days is rejected.
- Each row returns: id, project_id, project_name, title, due_date, priority, column_id, column_name, is_done (from `columns.is_done_column`), assignee_id, version, subtask_done, subtask_total. After 3C lands, it also returns open_blocker_count.
- The existing `project_timeline` RPC in `202610010001_project_timeline.sql` is the model to follow.

**Undated tasks:** `calendar_tasks` takes a fourth parameter, `p_include_undated boolean default false`. When it is true, the RPC also returns tasks whose `due_date` is null, in the same scope (the project, or the caller's assigned tasks), capped at 100 rows ordered by `updated_at desc`. These rows feed the "No due date" tray. The routes pass `undated=1` on the first load only.

**Routes**
- `GET /api/v1/projects/[projectId]/calendar?from&to`
- `GET /api/v1/me/calendar?from&to`

**UI: `src/components/calendar/`**
- `CalendarGrid` is hand-built.
  - Month view is the default: a 6×7 grid, weeks starting Monday, dates computed in `projects.timezone`. On My Tasks, it uses the browser's timezone.
  - A Week view toggle is available.
  - Each day shows up to 3 chips and a "+N more" popover.
  - A collapsible tray holds tasks with no due date.
- Pages
  - Project: a new Calendar tab in `src/components/project-nav.tsx` and a new page at `src/app/(app)/p/[projectId]/calendar/page.tsx`.
  - My Tasks: a List / Calendar toggle on `src/app/(app)/my-tasks/page.tsx`, beside `my-tasks-list.tsx`.
- Drag to reschedule reuses the board's dnd library (see `use-board-dnd.ts`).
  - Dropping a chip on a day calls the existing `PATCH /api/v1/tasks/[taskId]` (`update_task`) with `{ due_date, version }`, applied optimistically.
  - A P0004 conflict rolls back and shows the board's existing conflict toast (`isConflictPayload`).
  - Viewers can't drag. Keyboard users edit the due date in the drawer.
- Clicking a chip opens the existing `TaskDetailDrawer` (`src/components/board/task-detail-drawer.tsx`).
- Extra: an "x/y" subtask-progress chip on board cards (`project-board.tsx`) and on list rows. The counts come from the board/list read path.

### 3B Task links (replaces file attachments)
**Table `task_links`**
- Columns: id, project_id, task_id → tasks, url, title, created_by, created_at.
- `url` must match `^https?://` and be at most 2048 characters.
- `title` is optional and at most 200 characters. When empty, the UI shows the hostname.
- At most 50 links per task, enforced in the RPC.
- The RLS select policy allows project members only. There are no direct write policies.

**RPCs**
- `add_task_link(p_task_id, p_url, p_title)` requires `can_write_project`.
- `delete_task_link(p_link_id)` is allowed for the creator or an owner/admin.
- Both write activity entries. A migration adds `link_added` and `link_removed` to the `activity_action` enum.

**Routes**
- `GET` and `POST /api/v1/tasks/[taskId]/links`
- `DELETE /api/v1/tasks/[taskId]/links/[linkId]`

**UI**
- A Links section in the drawer.
  - Each entry shows a generic link icon, the title and the hostname, and opens with `target="_blank" rel="noopener noreferrer"`.
  - An inline form takes the URL and title.
  - Viewers can see links but can't edit them.
- A link-count chip on cards.

**Safety:** there is no server-side fetching or unfurling of URLs (no SSRF surface). Rows cascade when the task is purged.

### 3C Dependencies (warn, don't block)
**Table `task_dependencies`**
- Columns: project_id, blocker_task_id, blocked_task_id, created_by, created_at.
- Primary key is (blocker_task_id, blocked_task_id), with a check that blocker ≠ blocked.
- Both task foreign keys cascade.
- The RLS select policy allows project members.

**RPCs**
- `add_dependency(p_blocker, p_blocked)`
  - Both tasks must be in the same project, and the caller needs `can_write_project`.
  - A recursive CTE rejects cycles with a distinct error code.
  - At most 20 blockers per task.
- `remove_dependency(p_blocker, p_blocked)`
- Activity entries record both.

**Open blocker:** the blocker task is not deleted and its column is not `is_done_column`. The board, list and calendar read paths expose `open_blocker_count`.

**UI**
- Cards and rows show a "Blocked" badge when `open_blocker_count > 0`.
- The drawer shows "Blocked by" and "Blocking" lists, with a task picker that searches same-project tasks. The picker excludes the task itself and any existing links.
- Moving a task that has open blockers into an `is_in_progress_column` or `is_done_column` shows a confirm dialog listing those blockers. On confirm, the move goes through the unchanged `move_task`. This applies to both board drag and the column field in the drawer.

**Notification**
- Add a `blocker_resolved` value to `notification_type` and map it to the status category in `notification_category_for` (`202609230001_notifications.sql`).
- A trigger on task column change fires when a task enters the done column. For each task it blocks, if that task now has zero open blockers, it calls `enqueue_notifications('blocker_resolved', …)` for that task's assignee. The trigger follows `notify_comment_mentions` in `202609230002_notification_events.sql`.
- The Notifications Center renders the new type.

## Testing and verification
**Per sub-plan**
- Unit tests for the components: CalendarGrid date math (timezone and month boundaries), chip overflow, the drag handler with conflict rollback, the links form validation, and the dependency picker and confirm dialog.
- RLS integration tests for each new RPC and table:
  - non-members get nothing back;
  - viewers can't write;
  - the cross-project dependency is rejected;
  - the cycle is rejected;
  - the link URL scheme is enforced;
  - the 42-day range cap holds;
  - `blocker_resolved` is enqueued exactly once.
- `npm test`, `npm run test:rls`, lint, typecheck and `next build` all pass.

**End-to-end**
- Run the dev server without Docker and check the flow in a browser.
- Calendar: drag a task to a new day and confirm the due date persists.
- Links: add a link and confirm it opens in a new tab.
- Dependencies: create A→B. Moving B to In Progress shows the warning. Completing A notifies B's assignee.
- Look at the result in both light and dark themes.

## Delivery
There are three implementation plans, executed in order. Each depends on the one before it:
1. **3A Calendar.** It adds `calendar_tasks` and the subtask-progress chip.
2. **3B Task links.** It adds `task_links` and the link-count chip.
3. **3C Dependencies.** It adds `open_blocker_count` to the read paths, including `calendar_tasks` from 3A.

## Out of scope
- File uploads and Supabase Storage. These were deferred by the user, and links cover the need for now.
- Subtasks as full child tasks. Subtasks stay a checklist.
- Changes to the task-detail drawer or descriptions beyond the new Links and Dependencies sections.
- Hard enforcement of dependencies in `move_task`.
- Gantt charts and dependency lines on the calendar.

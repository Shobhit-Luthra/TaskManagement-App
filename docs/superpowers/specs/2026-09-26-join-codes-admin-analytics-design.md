# Plan: Board join codes (with admin approval) + admin-only Analytics

## Context

The user wants two things:

1. **Join a board with a 6-digit code.** An admin generates a numeric code. Anyone signed in can enter it to *request* to join, and an admin approves the request before the person becomes a member.
2. **Admin-only Analytics.** The tab should show progress in full.

What already exists (from exploring the code):

- **"Board" is a project.** There is no separate board entity. The URL is `/p/[projectId]/board`, and membership is `public.memberships(project_id, user_id, role)` with roles `owner|admin|member|viewer`.
- **Email invitations already exist** and use hashed 32-byte tokens:
  - migrations: `202609160004_invitations_create.sql`, `202609170001_invitations_accept.sql`
  - routes: `src/app/api/v1/projects/[projectId]/invitations/`
  - UI: `src/components/members/invite-dialog.tsx`
  - Join codes are a second path that sits beside invitations. It does not replace them.
- **The Analytics tab already exists**, and every member can see it:
  - page: `src/app/(app)/p/[projectId]/analytics/page.tsx`
  - five `analytics_*` RPCs in `supabase/migrations/202609250004_analytics.sql`, with a cycle-time fix in `…0005`
  - five API routes under `src/app/api/v1/projects/[projectId]/analytics/`
  - components in `src/components/analytics/`, drawn with recharts
- **Decisions from the user this session:**
  - One shared code per board, and every join needs an admin's approval.
  - The code carries **no role**. The approving admin chooses the role when they approve each request. The allowed roles are `admin`, `member` and `viewer`, limited to roles ranked below the approver: an owner can grant admin, member or viewer, and an admin can grant member or viewer.
  - Analytics is admin-only and gains:
    - an overall progress bar and a breakdown by column
    - a progress table per member
    - a list of overdue and at-risk tasks
    - breakdowns by priority and by label
  - Analytics stays per-board. No view across boards.

Standing constraints from memory:

- Business logic lives in `security definer` plpgsql RPCs, and route handlers stay thin and use `withApiHandler`.
- Free tier only.
- Email stays stubbed.
- Commits must not carry Claude trailers.
- No Docker.

Work on a branch `feat/join-codes-admin-analytics`, not `main`. Before writing code, save this plan as the design record at `docs/superpowers/specs/2026-09-26-join-codes-admin-analytics-design.md`.

---

## Part A: Join codes and join requests

### A1. Migrations

**`supabase/migrations/202610040001_activity_action_join.sql`**
- Add the `activity_action` values `join_requested` and `join_denied`. They go in their own file because an enum value can't be used in the transaction that adds it. `task_links` follows the same pattern in `202610030001`.
- Add the `notification_type` value `join_requested` and the `notification_category` value `membership`.

**`supabase/migrations/202610040002_join_codes.sql`**

**Table `project_join_codes`**
- Columns:
  - `project_id` uuid, primary key, references `projects`, `on delete cascade`. One row per project.
  - `code` char(6), not null, **globally unique**, with `check (code ~ '^[0-9]{6}$')`.
  - `created_by`, `created_at`.
  - `expires_at`, default `now() + interval '7 days'`.
  - `disabled_at`.
- Enable **and** force RLS. The only read policy is for owners and admins of that project. There are no write policies.
- The code is stored in plaintext so admins can display it again. This is acceptable because a code only lets someone *request* access; approval is still the gate.
  - Hashing would not help anyway: a 10⁶-value space can be enumerated offline in milliseconds.

**Table `join_requests`**
- Columns: `id`, `project_id`, `user_id`, `status` (`pending|approved|denied`), `created_at`, `decided_by`, `decided_at`, `granted_role`.
- Partial unique index on `(project_id, user_id) where status = 'pending'`.
- Index on `(project_id, status, created_at desc)`.
- RLS read policies: owners and admins of the project see every row, and a requester sees their own rows. There are no write policies.

**Helper**
- Add `is_project_admin(p_project_id)`, `security definer`, returning `role in ('owner','admin')`. Part B reuses it.

**RPCs**
All RPCs use the `add_task_link` shape from `202610030002_task_links.sql`: `28000`, then `P0002`, then `42501`, then `22023`, then write plus activity, then revoke from `public, anon` and grant to `authenticated`.

- **`generate_join_code(p_project_id)`**
  - Owner or admin only.
  - Generates the code with a CSPRNG: `lpad((('x'||encode(extensions.gen_random_bytes(4),'hex'))::bit(32)::bigint % 1000000)::text, 6, '0')`.
  - Upserts the project's row with a new code, a 7-day expiry and `disabled_at = null`. This one call covers "rotate".
  - On a unique collision it retries up to 5 times.
  - Returns `code, expires_at`.
- **`disable_join_code(p_project_id)`**: owner or admin only. Sets `disabled_at`.
- **`request_to_join(p_code text)`**
  - Requires authentication.
  - The input must match `^[0-9]{6}$`; otherwise raise `22023`.
  - Looks up an active code: not disabled, not expired, project not archived or deleted.
  - Missing, expired, disabled and malformed-but-6-digit codes all raise one error: **`P0002 INVALID_CODE`**. That way a caller can't tell a real code from a fake one.
  - An existing member gets `23505`.
  - If the caller already has a pending request, return it (idempotent).
  - Cap pending requests at 50 per project; above that, raise `P0003 JOIN_QUEUE_FULL`.
  - Inserts the request, a `join_requested` activity row and one `join_requested` notification per owner or admin.
  - Returns `request_id, project_name, status`.
- **`decide_join_request(p_request_id, p_approve boolean, p_role membership_role default null)`**
  - Locks the row with `for update`.
  - Owner or admin of that project only.
  - A request that is no longer pending raises `P0003`.
  - On approve:
    - `p_role` is **required**; if it is missing, raise `22023`
    - the role must not be `owner`, and must rank below the approver (the `membership_role_rank` rule from `202609160004`); otherwise raise `CANNOT_GRANT_ROLE`, which maps to 403
    - it inserts the membership (a `23505` race is swallowed, and the request is marked approved)
    - it writes a `member_added` activity row with `{via:'join_code'}`
  - On deny: sets `denied` and writes a `join_denied` activity row.
- **`cancel_join_request(p_request_id)`**: the requester deletes their own pending request.

**Retention**
- Add to the existing retention job (`202609250008`):
  - delete `project_join_codes` rows whose expiry passed more than 1 day ago, so dead codes don't take up space in the code range
  - delete decided `join_requests` older than 90 days

### A2. Security properties

A 6-digit code has only 10⁶ possible values, so this endpoint is brute-forceable unless the plan enforces these. Each one needs a test.

1. **No enumeration.** Every invalid-code case returns the same 404 body, `{code:"INVALID_CODE"}`, and takes the same path.
2. **Rate limits at two scopes.** In `src/lib/api/rate-limit.ts` add:
   - `joinCode: {limit: 10, windowSeconds: 900}`, keyed by user
   - `joinCodeDaily: {limit: 30, windowSeconds: 86400}`, keyed by user
   - `joinCodeIp: {limit: 30, windowSeconds: 900}`, keyed by IP

   The user key goes through `withApiHandler`. The route also calls `consumeRateLimit` itself with the two extra policies: the daily one keyed by user, and the IP one keyed by `ipSubject(request)`. This is the first use of `ipSubject` in a route. Limits fail closed, which is the existing behaviour.
3. **Bounded input.** Zod `z.string().regex(/^\d{6}$/)` runs before anything touches the database. The SQL check repeats it.
4. **Approval is the real gate.** A guessed code only creates a request that an admin sees and can deny. Membership is never granted without an admin's action.
5. **Codes expire** after 7 days, can be rotated or turned off, and are cleared from the table after expiry.
6. **Role cap.** A code grants nothing by itself; the approver picks the role. Approval can never grant `owner`, or any role at or above the approver's own.

### A3. API routes

All routes use `withApiHandler`, `mapRpcError` and `firstRow` from `src/lib/api/handler.ts`. Schemas go in a new `src/lib/join-codes/schemas.ts` with a co-located `schemas.test.ts`.

- **`src/app/api/v1/projects/[projectId]/join-code/route.ts`**
  - GET: read the code through RLS. Admins get it; others get 404.
  - POST calls `generate_join_code`. It takes no body.
  - DELETE: calls `disable_join_code`.
  - Uses `RATE_LIMITS.writes`.
- **`src/app/api/v1/join/route.ts`**: POST `{code}` calls `request_to_join` and returns 202 `{projectName, status:"pending"}`.
- **`src/app/api/v1/projects/[projectId]/join-requests/route.ts`**: GET lists pending requests with the requester's display name from `project_peers`, or from the `users` join done inside the RPC or view.
- **`src/app/api/v1/join-requests/[requestId]/route.ts`**
  - PATCH takes a discriminated body: `{decision:"approve", role}`, where `role` is required, or `{decision:"deny"}`. It calls `decide_join_request`.
  - DELETE calls `cancel_join_request`.

### A4. UI

These use the shadcn primitives in `src/components/ui/`.

**Admin side**
- `src/components/members/invite-dialog.tsx` gets two tabs, "Email invite" and "Join code", using `ui/tabs`.
- The Join code tab uses a new `src/components/members/join-code-panel.tsx`. It shows:
  - the code in large monospace digits with a Copy button
  - the expiry date
  - a note: "People who use this code need your approval. You choose their role when you approve."
  - Regenerate and Turn off buttons
- A new `src/components/members/join-requests.tsx` goes on `settings/members/page.tsx`, above `pending-invitations.tsx`:
  - a list of pending requests, each with the requester's avatar and name and the time they asked
  - a role select on each request, offering only the roles the viewer can grant (an owner sees admin, member and viewer; an admin sees member and viewer) and with **no default**
  - Approve stays disabled until a role is picked; Deny is always available
  - The Members settings page shows a badge with the number of pending requests.

**Joiner side**
- A "Join a board" button on `/projects` (`src/components/projects/projects-workspace.tsx`) and in the sidebar (`src/components/app-shell.tsx`) opens a new `src/components/projects/join-board-dialog.tsx`:
  - six-digit input with `inputMode="numeric"`, `autoComplete="one-time-code"`, pasting supported, submit once 6 digits are entered
  - on success it says "Request sent to *Project*. You'll get access when an admin approves."
  - on 404 it says "That code isn't valid or has expired."
  - on 429 it says "Too many attempts, try later."
- `/projects` gets a "Pending requests" strip listing the caller's own pending rows, each with Cancel.
- After approval, the project shows up in the sidebar the next time it loads. Live update is out of scope; see the note at the end.

**Notification**
- Render `join_requested` in the existing notifications list. It links to `/p/[id]/settings/members`.

### A5. Tests

- **`src/test/rls/join-codes.test.ts`**, built on `seedIsolationFixture()`, covers:
  - A member or viewer can't generate a code, read one or decide a request.
  - A generated code is 6 digits, and rotating it changes it.
  - Expired, disabled and nonexistent codes all give the same P0002.
  - An existing member gets 23505.
  - Asking twice returns the same pending request.
  - Approve inserts the membership with the chosen role.
  - Approving with no role is rejected.
  - An admin approving as `admin` is rejected; an owner approving as `admin` succeeds.
  - `owner` is always rejected.
  - Deny adds no membership.
  - A requester can see only their own requests.
  - A non-admin can't read `project_join_codes`.
  - The queue cap applies.
- **Unit tests**:
  - the schemas
  - the route's rate-limit wiring: it returns 429 when the IP policy blocks, using a mocked `consumeRateLimit`
  - `join-board-dialog` behaviour: validation, the error copy for each status, paste

---

## Part B: Admin-only Analytics with progress views

### B1. Gate to owner and admin in all three layers

- **Migration `supabase/migrations/202610040003_analytics_admin_only.sql`**
  - `create or replace` the five existing analytics RPCs, copying the **latest** bodies (cycle time comes from `…0005`).
  - The only change is the membership check: `if not public.is_project_admin(p_project_id) then raise … 'P0002'`.
  - P0002 means a non-admin can't tell the project exists, and the page already turns P0002 into a 404.
- **Nav**: in `src/components/project-nav.tsx`, wrap the Analytics tab (around L181) in the same `["owner","admin"].includes(role)` check that Settings uses.
- **Page**: in `analytics/page.tsx`, fetch the caller's role the way `layout.tsx` L10-22 does, and call `notFound()` for non-admins.
  - Filter by `user_id`. Don't copy the unfiltered query at `settings/page.tsx` L17.

### B2. New RPCs

These go in migration `202610040004_analytics_progress.sql`. Each is `security definer`, gated with `is_project_admin` and granted to `authenticated`. They exclude soft-deleted tasks and deleted columns, and compute "today" in `projects.timezone`, the same way `analytics_summary` does.

- **`analytics_column_breakdown(p_project_id)`**
  - Returns `column_id, name, position, is_done_column, is_in_progress_column, task_count`.
  - The overall progress % (done out of total) is worked out from these rows on the client.
- **`analytics_member_progress(p_project_id, p_days int default 30)`**
  - Returns one row per member plus an Unassigned row, with these columns: `member_user_id, display_name, avatar_url, role, open_count, in_progress_count, completed_in_period, overdue_count, due_soon_count`.
    - "Due soon" means due within the next 7 days.
  - `completed_in_period` counts `completed` activity rows on tasks currently assigned to the member, keeping only the latest completion per task after the latest reopen. This uses the same rule the existing throughput and cycle-time RPCs use.
- **`analytics_at_risk(p_project_id, p_limit int default 50)`**
  - Returns open tasks that are overdue or due within 3 days: `task_id, title, due_date, priority, column_name, assignee_id, assignee_name, is_overdue, days_until_due`.
  - Ordered by `due_date` and then priority descending.
- **`analytics_breakdown(p_project_id)`**
  - Returns `dimension ('priority'|'label'), key, name, color, open_count, done_count`.
  - Covers every priority value, and every label joined through `task_labels`.
- **Index**: add `activity (task_id, action, created_at desc)`. The cycle-time and completion subqueries filter on it, and no index covers them today.
- **Routes**: add one route per RPC under `src/app/api/v1/projects/[projectId]/analytics/`, named `columns`, `members`, `at-risk` and `breakdown`. Copy the existing `summary` route: `RATE_LIMITS.analytics` and `Cache-Control: private, max-age=300`. Add query schemas to `src/lib/analytics/schemas.ts`.

### B3. UI

Load the `dataviz` skill before writing the charts. The page layout, top to bottom:

1. The existing stat tiles.
2. **`progress-overview.tsx`**:
   - a large "X% complete (done/total)" progress bar
   - below it, a single horizontal stacked bar coloured by column, with a legend
3. The existing throughput, cycle time and cumulative flow charts.
4. **`member-progress-table.tsx`**:
   - a sortable table with one row per member (avatar and name, open, in progress, completed in the last 30 days, overdue, due soon)
   - a mini progress bar per member
   - it replaces the existing workload bar chart, whose data it contains; delete `workload-chart.tsx` only if nothing else uses it
5. **`at-risk-list.tsx`**:
   - rows for overdue tasks (red) and tasks due soon (amber)
   - each row links to the task drawer on the board, using its existing URL parameter
6. **`breakdown-chart.tsx`**: two small horizontal stacked bars (open vs done), one by priority and one by label.

Wrap each new section in the existing `chart-error-boundary`, and use `insufficient-data-card` when there is no data.

Two small fixes:
- **Chart colours**: add `--color-chart-1…6` tokens, mapped to the warm brand palette, to both themes in `src/app/globals.css`. The charts reference these variables today but they aren't defined, so every chart falls back to indigo and slate.
- **Heading style**: make the page heading use `font-serif text-headline-lg`, like the other pages.

### B4. Tests

- **Extend `src/test/rls/analytics.test.ts`**:
  - a `member` calling each of the 5 old and 4 new RPCs gets P0002
  - owners and admins get data
  - seeded tasks produce the expected column counts, member rows (including Unassigned), at-risk ordering and priority and label counts
  - soft-deleted tasks are excluded
- **Component tests**: one for each of the new components (sorting, empty states, percentage rounding), plus one checking that `project-nav` hides Analytics for member and viewer.

---

## Order of work

These are separate commits, in this order, with conventional messages and no AI trailers:

1. Add the enum migrations.
2. Add the join-code schema and RPCs, with RLS tests.
3. Add the join-code routes and schemas.
4. Build the join-code UI: admin panel and requests list, joiner dialog, notification.
5. Gate analytics to admins: migration, nav and page.
6. Add the analytics progress RPCs, index and routes.
7. Build the analytics UI and the chart tokens.

## Verification

- `npm run typecheck && npm run lint && npm run test:coverage`. Coverage on `src/lib/**` must stay at 70% or above.
- `npm run test:rls` against the test project in `.env.test`, then `supabase db push --dry-run`. CI does both.
- **Manual check**: run the dev server (no Docker) and use the `run` skill for headless screenshots.
  1. As the owner, open the invite dialog, go to the Join code tab, generate a code and copy it.
  2. As a second user, choose "Join a board", enter a wrong code (expect the generic error), then the right code (expect "Request sent").
  3. The owner gets a notification and sees the request in Settings → Members, then approves it as member.
  4. The second user now sees the project in `/projects`.
  5. Submit wrong codes quickly until a 429 comes back.
  6. As the new member, the Analytics tab is hidden, `/p/<id>/analytics` returns 404, and `GET /api/v1/projects/<id>/analytics/summary` returns 404.
  7. As the owner, every analytics section renders, in light and dark themes.

## Out of scope

- Updating the joiner's sidebar live when a request is approved. `memberships` is already in the Realtime publication; add this later if wanted.
- Burn-up chart: the existing cumulative flow diagram already shows created vs done over time.
- Analytics across boards.
- Emailing admins about join requests. Email is still stubbed, so the in-app notification only.

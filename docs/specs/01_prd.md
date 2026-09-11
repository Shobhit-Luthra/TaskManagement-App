# 01 — Product Requirements Document

**Product:** Kanbo
**Depends on:** `00_project_analysis.md`
**Status:** Draft for approval

---

## 1. Product Overview

Kanbo is a real-time, multi-user Kanban board for small teams. Teams create projects, define workflow columns, and move tasks across them. Every change propagates live to all viewers. An activity log underpins a weekly digest and an analytics dashboard that tell the team whether they are actually delivering.

It is intentionally narrower than Asana: no portfolios, no custom fields, no integrations. The trade is adoption speed for configurability.

---

## 2. Problem Statement

Small teams lack shared, durable state about who is doing what by when. Chat has no state. Spreadsheets have no notifications and break under concurrency. Enterprise tools impose a configuration cost that exceeds their value below ~20 people. The result is duplicated work, missed deadlines, and no visibility into whether the team is improving.

---

## 3. Vision

A team should be able to sign up, invite four people, and have a live shared board in under ten minutes — and four weeks later be able to answer "are we getting faster?" with data rather than opinion.

---

## 4. Goals

| ID | Goal | Measure |
|---|---|---|
| G1 | Time-to-first-value under 10 minutes | Median signup → first task created |
| G2 | Board interactions feel instantaneous | Drag-to-visual-update p95 < 50 ms |
| G3 | Teams trust the state | Zero data-loss incidents; conflict rate < 0.1% of moves |
| G4 | Teams gain delivery visibility | ≥40% of active projects open Analytics weekly |
| G5 | Secure by construction | No cross-project data access possible via API |

---

## 5. Non-Goals

Per `00 §10`. Additionally, for MVP: no offline mode, no undo history beyond soft delete, no per-project custom permission matrices.

---

## 6. Target Users

Student project teams, small startup teams, freelance/agency pods. See `00 §2`.

---

## 7. User Personas

**P1 — Aditi, Project Lead (25).** Runs a 6-person team. Needs to see blockers without asking. Lives in the board's Filter view. Primary consumer of Analytics.

**P2 — Rahul, Contributor (22).** Cares about one thing: what is assigned to him and when it is due. Uses the app on a phone, on a commute. Never opens Analytics.

**P3 — Sana, Client/Stakeholder (34).** Wants read-only visibility. Should not be able to move cards. *(Gated on decision M3.)*

---

## 8. User Pain Points

| Persona | Pain | Feature that addresses it |
|---|---|---|
| Aditi | "I don't know what's blocked until standup" | Filters, overdue badges, weekly digest |
| Aditi | "I can't tell if we're improving" | Analytics dashboard |
| Rahul | "I have to scan the whole board to find my work" | `Assigned to me` filter, My Tasks view |
| Rahul | "The board is unusable on my phone" | Responsive single-column board |
| All | "Two of us edited the same thing and one change vanished" | Realtime sync + conflict handling |
| Sana | "I need visibility without being able to break anything" | Viewer role |

---

## 9. User Stories

**Authentication**
- As a new user, I can sign up with email and password so I can create a board.
- As a returning user, I can sign in with Google so I don't manage another password.
- As a user who forgot my password, I can request a reset link.

**Projects & Membership**
- As an owner, I can create a project so my team has a shared space.
- As an owner, I can invite a teammate by email and assign a role.
- As an invitee, I can accept an invitation and land directly on the board.
- As an owner, I can remove a member so ex-teammates lose access immediately.

**Board & Tasks**
- As a member, I can create a column so the board matches our workflow.
- As a member, I can create a task with a title in one keystroke path.
- As a member, I can assign a task, set a due date and a priority.
- As a member, I can drag a task between columns and the position persists.
- As a member, I can reorder tasks within a column.
- As a member, I can open a task to edit details, add subtasks and comment.
- As a member, I can see teammates' changes live without refreshing.
- As a member, I can soft-delete a task and restore it within the retention window.

**Search & Filter**
- As a member, I can filter by assignee, label, priority, due state.
- As a member, I can search tasks by title and description text.

**Notifications**
- As a member, I am notified when a task is assigned to me.
- As a member, I am notified when someone @mentions me in a comment.
- As a member, I receive a weekly email digest.
- As a member, I can mute notification categories.

**Analytics**
- As a lead, I can see completed-tasks-per-week.
- As a lead, I can see median cycle time and its trend.
- As a lead, I can see a cumulative flow diagram to spot bottlenecks.
- As a lead, I can see open task counts per member to spot overload.

---

## 10. Core User Journeys

**J1 — Onboarding to first value**
Landing → Sign up → Verify email → Create project (name only) → Board seeded with To Do / In Progress / Done → Inline "add a task" → Invite modal → First task created.
*Success criterion: ≤10 min, ≤2 required text inputs before a board exists.*

**J2 — Daily contributor loop**
Login → My Tasks → Open task → Comment → Drag to In Progress → Later drag to Done.

**J3 — Lead review loop**
Board → Filter `overdue` → Reassign → Open Analytics → Read cycle-time trend.

**J4 — Invitation acceptance**
Email link → (if no account) Sign up prefilled with invited email → Membership auto-created → Redirect to board.
*Edge: invited email ≠ signup email → invitation must not auto-consume.*

---

## 11. Functional Requirements

Every requirement is specified with the nine attributes required by the brief. Abbreviated table form where the pattern repeats.

### FR-1 — User Registration
- **Purpose:** Create an authenticated identity.
- **User:** Anonymous visitor.
- **Trigger:** Submits signup form.
- **Inputs:** email, password, display name.
- **Processing:** Validate → check uniqueness → hash password (handled by Supabase Auth, bcrypt) → create `users` row → dispatch verification email.
- **Output:** Session token; redirect to project creation.
- **Validation:** RFC-5322 email; password ≥10 chars, not in breach list; name 1–80 chars.
- **Failure states:** Email in use (409, generic message to prevent enumeration); weak password (422); mail service down (account created, verification retried).
- **Dependencies:** Auth provider, mail service.

### FR-2 — Project Creation
- **Purpose:** Create a workspace boundary.
- **User:** Any authenticated user.
- **Trigger:** "New project".
- **Inputs:** name, optional description.
- **Processing:** Transaction — insert `projects`; insert `memberships` (creator = `owner`); insert three default `columns`; write `activity`.
- **Output:** Board screen.
- **Validation:** name 1–120 chars, non-blank after trim.
- **Failure states:** Partial creation must be impossible — single transaction, all-or-nothing.
- **Dependencies:** DB transaction support.

### FR-3 — Invite Member
- **Purpose:** Grant a person access at a role.
- **User:** Owner or Admin.
- **Trigger:** Invite modal submit.
- **Inputs:** email, role.
- **Processing:** Authorize actor → if user exists, create membership directly; else create `invitations` row with cryptographically random token and 7-day expiry → send email.
- **Output:** Pending member row in UI.
- **Validation:** Valid email; role ∈ {admin, member, viewer}; a Member cannot invite; nobody can grant a role above their own.
- **Failure states:** Already a member (409); invitation already pending (idempotent re-send, no duplicate row); expired token on accept (410 with re-request option).
- **Dependencies:** FR-1, mail service.

### FR-4 — Create Task
- **Purpose:** Capture a unit of work.
- **User:** Member+.
- **Trigger:** Inline composer in a column, or `N` keyboard shortcut.
- **Inputs:** title (required); column; optional assignee, due date, priority, labels.
- **Processing:** Compute `position` as `min(position) - 1` for top insert (default) → insert → write `activity` → broadcast realtime event → enqueue assignment notification if assignee set.
- **Output:** Card rendered optimistically, reconciled on server ack.
- **Validation:** title 1–200 chars; assignee must be a project member; due date may be in the past (warn, do not block).
- **Failure states:** Network failure → card marked "unsaved" with retry, never silently dropped.
- **Dependencies:** FR-2.

### FR-5 — Move / Reorder Task
- **Purpose:** Advance workflow state.
- **User:** Member+.
- **Trigger:** Drag-drop, or keyboard move.
- **Inputs:** task id, target column id, neighbouring positions.
- **Processing:** Client computes `newPosition = (prev + next) / 2` → optimistic state update → `PATCH` → server re-validates membership and column ownership → updates row → writes `activity` with `from_column`/`to_column` → broadcasts.
- **Output:** Card in new location on all clients.
- **Validation:** Target column must belong to the same project. Position must be finite.
- **Failure states:** Server rejection → animated revert + toast. Precision exhaustion → server triggers column renormalisation and returns canonical positions.
- **Dependencies:** FR-4, activity log.

### FR-6 — Comments and @Mentions
- **Purpose:** Keep discussion attached to work.
- **User:** Member+ (Viewers may read only).
- **Trigger:** Comment composer in task detail.
- **Inputs:** body (markdown subset), mentioned user ids.
- **Processing:** Sanitize → insert → notify mentioned members → broadcast.
- **Output:** Comment in thread.
- **Validation:** 1–5000 chars; mentions resolved against project membership only.
- **Failure states:** Mentioned user is not a member → mention rendered as plain text, no notification.
- **Dependencies:** FR-3.

### FR-7 — Search and Filter
- **Purpose:** Reduce a board to the relevant subset.
- **User:** Any member.
- **Trigger:** Filter bar / search input (debounced 250 ms).
- **Inputs:** assignee[], label[], priority[], due state, free text.
- **Processing:** Applied client-side when the board is fully loaded (A1); server-side beyond the threshold via indexed query.
- **Output:** Filtered board; active filters shown as removable chips; state encoded in the URL so views are shareable.
- **Validation:** Unknown filter keys ignored, not errored.
- **Failure states:** No matches → empty state with "Clear filters".
- **Dependencies:** FR-4.

### FR-8 — Activity Log
- **Purpose:** Immutable record enabling audit, digest and analytics.
- **User:** System-written; member-readable.
- **Trigger:** Every mutation on tasks, columns, memberships.
- **Inputs:** actor, entity, action, from/to values.
- **Processing:** Append-only insert inside the same transaction as the mutation.
- **Output:** Activity feed; source data for FR-9 and FR-10.
- **Validation:** Never updated or deleted by application code.
- **Failure states:** If the activity insert fails, the whole transaction rolls back. The log is not best-effort — analytics correctness depends on it.
- **Dependencies:** All mutating features.

### FR-9 — Weekly Summary (deterministic)
- **Purpose:** Push a factual delivery digest.
- **User:** All project members not opted out.
- **Trigger:** Scheduled job, Monday 09:00 in project timezone; also renderable on demand in-app.
- **Inputs:** project id, 7-day window.
- **Processing:** Aggregate queries over `activity` and `tasks` — completed count and titles, created count, newly overdue, per-member completions, due in next 7 days. **No language model is used**; the template is fixed and the numbers come from SQL.
- **Output:** In-app panel + email.
- **Validation:** Counts must reconcile with the activity log; asserted in tests.
- **Failure states:** Zero activity → send a short "quiet week" variant rather than an empty email; mail failure → retry with backoff, in-app panel unaffected.
- **Dependencies:** FR-8, scheduler, mail service.

### FR-10 — Analytics Dashboard
- **Purpose:** Show delivery trends.
- **User:** Owner, Admin, Member (Viewer: read-only, same data).
- **Trigger:** Analytics tab.
- **Inputs:** project id, date range (default 12 weeks).
- **Processing:**
  - *Throughput* — count of `completed` activity events grouped by ISO week.
  - *Cycle time* — per task, first transition into an `in_progress`-flagged column until `completed`; report the **median** (a single 90-day stale task destroys a mean).
  - *Cumulative flow* — read from `board_snapshots`, written daily. **Not derivable retroactively.**
  - *Workload* — open tasks grouped by assignee.
  - *Overdue rate* — open tasks past `due_date` ÷ open tasks.
- **Output:** Five visualisations.
- **Validation:** Ranges with <2 data points render an "insufficient data" state rather than a misleading chart.
- **Failure states:** Missing snapshots for a date → gap in the CFD, explicitly labelled, never interpolated.
- **Dependencies:** FR-8, snapshot job.

### FR-11 — Notifications
In-app notification centre plus email. Categories: assignment, mention, due-soon (24h), status change on watched task, weekly digest. Per-user per-category mute. Email sends are batched — a burst of ten assignments produces one email, not ten.

### FR-12 — Soft Delete and Restore
Tasks, columns and projects set `deleted_at` rather than hard-deleting. Restorable for 30 days (pending M5), then purged by a scheduled job. Deleting a column requires choosing: move its tasks to another column, or delete them with it.

---

## 12. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Board TTI < 2.0s on 4G; drag feedback < 50 ms p95; API p95 < 300 ms |
| Realtime | Change visible to other clients < 1s p95 |
| Availability | 99.5% monthly (portfolio-grade; raise if M6 says production) |
| Scalability | 500 tasks/project, 25 members/project, 10 concurrent viewers/board without degradation |
| Security | See `07_security_spec.md` |
| Accessibility | WCAG 2.1 AA |
| Browser support | Latest 2 versions of Chrome, Firefox, Safari, Edge |
| Observability | Structured logs, error tracking, uptime checks |
| Maintainability | TypeScript strict mode; no `any` in application code; ≥70% coverage on business logic |

---

## 13. Feature Prioritization

**P0 — Critical (MVP ships without these unbuilt = no product)**
Auth; projects; membership + roles; columns; tasks with assignee/due/priority; drag & drop; realtime sync; activity log; RLS authorization; responsive board.

**P1 — Important (ships within MVP window if schedule holds)**
Comments + mentions; labels; filters + search; subtasks; notifications; weekly summary; analytics dashboard; list view; dark mode; soft delete.

**P2 — Nice to have (explicitly post-MVP)**
Calendar view; attachments; public share links; recurring tasks; timeline/Gantt; saved filter views; CSV export; bulk edit.

---

## 14. MVP Scope

All P0, plus P1 items: comments, labels, filters, activity feed, weekly summary, analytics dashboard, dark mode, soft delete.

**Deferred from MVP:** attachments, calendar view, share links, recurring tasks, timeline.

---

## 15. Future Scope

Phase 2: attachments, timeline with dependencies, saved views, CSV export.
Phase 3: integrations (Slack, GitHub), public share links, guest access.
Phase 4: optional AI layer at the seam defined in `00 §5` — natural-language capture as a confirmable proposal, semantic search as re-ranking only.

---

## 16. Business Rules

- BR-1 — Every project has exactly one Owner at all times. Ownership transfer is explicit; the last Owner cannot leave or be removed.
- BR-2 — A user cannot grant a role higher than their own.
- BR-3 — Column `position` and task `position` are unique-by-ordering within their parent, but not enforced as a DB unique constraint (fractional indexing requires gaps).
- BR-4 — A task belongs to exactly one column; a column to exactly one project.
- BR-5 — Assignee must be a current member. Removing a member unassigns their open tasks and records it in the activity log.
- BR-6 — A task is "complete" when it is in a column flagged `is_done_column`, not when a boolean is set. This keeps analytics aligned with the visible board.
- BR-7 — Activity rows are append-only.
- BR-8 — Deleting a project soft-deletes all descendants in one transaction.
- BR-9 — Invitations expire after 7 days and are single-use.

---

## 17. Roles and Permissions

| Action | Owner | Admin | Member | Viewer |
|---|:--:|:--:|:--:|:--:|
| View board, tasks, comments | ✅ | ✅ | ✅ | ✅ |
| Create / edit / move tasks | ✅ | ✅ | ✅ | ❌ |
| Comment | ✅ | ✅ | ✅ | ❌ |
| Manage columns | ✅ | ✅ | ✅ | ❌ |
| Invite / remove members | ✅ | ✅ | ❌ | ❌ |
| Change member roles | ✅ | ✅¹ | ❌ | ❌ |
| View analytics | ✅ | ✅ | ✅ | ✅ |
| Rename / archive project | ✅ | ✅ | ❌ | ❌ |
| Delete project | ✅ | ❌ | ❌ | ❌ |
| Transfer ownership | ✅ | ❌ | ❌ | ❌ |

¹ Admins may not create or modify Owners.

---

## 18. Notifications

| Event | In-app | Email | Default |
|---|:--:|:--:|---|
| Task assigned to you | ✅ | ✅ | On |
| @mention | ✅ | ✅ | On |
| Comment on watched task | ✅ | ❌ | On |
| Task due in 24h | ✅ | ✅ | On |
| Weekly digest | ✅ | ✅ | On |
| Invitation received | ❌ | ✅ | Always (transactional) |

Rules: no self-notifications; email batched on a 5-minute window; every non-transactional email carries an unsubscribe link.

---

## 19. Search and Filtering Requirements

- Filter dimensions: assignee (multi), label (multi), priority (multi), due state (`overdue` / `today` / `this week` / `none`), text.
- Text search covers task title and description, case-insensitive, substring. Postgres `ILIKE` with a trigram index is sufficient at MVP scale; upgrade to `tsvector` full-text if A1 is exceeded.
- Filters compose with AND across dimensions, OR within a dimension.
- Active filters serialise to query params → views are shareable and survive refresh.
- Board respects filters during drag (a card dragged out of the filtered set fades rather than vanishing abruptly).

---

## 20. AI Functionality

**Not applicable for MVP by explicit decision.** See `00 §5` for rationale and the re-entry boundary. The weekly summary is deterministic SQL, not generation.

---

## 21. Integrations

MVP: authentication provider (Google OAuth), transactional email provider. Nothing else. Slack/GitHub/Calendar are Phase 3.

---

## 22. Error and Empty States

| Context | Empty state | Error state |
|---|---|---|
| No projects | Illustration + "Create your first project" CTA | Retry button, no stack traces |
| Empty column | Dashed drop target + "Add a task" | — |
| Filter yields nothing | "No tasks match" + "Clear filters" | — |
| No comments | "Start the discussion" | Composer preserves draft text on failure |
| Analytics, <2 weeks data | "Not enough data yet — check back after a week" | Chart-level error, page still renders |
| Realtime disconnected | — | Persistent banner "Reconnecting…", board becomes read-only after 30s |
| 403 | — | "You don't have access to this project" — never reveals whether it exists |

---

## 23. Edge Cases

- Two users drop cards into the same slot simultaneously → both persist, fractional positions differ, order resolves deterministically.
- User is removed while viewing the board → realtime channel closes, redirect with explanation.
- Assignee removed from project → tasks unassigned, logged.
- Column deleted while a teammate is dragging into it → drop rejected, card reverts, toast explains.
- Due date set in the past → allowed with a warning (backfilling real work is legitimate).
- Task moved back out of Done → cycle time recalculated on the *latest* completion event.
- Invitation sent to an email that later signs up via Google with the same address → invitation matches on verified email.
- Clock skew across timezones → all timestamps stored UTC, rendered in the viewer's local zone; "overdue" evaluated server-side.
- 50+ consecutive inserts into the same position gap → renormalisation triggered.

---

## 24. Accessibility Requirements

- WCAG 2.1 AA; contrast ≥4.5:1 for text, ≥3:1 for UI boundaries.
- **Drag & drop must have a full keyboard equivalent** — focus a card, `Space` to lift, arrows to move, `Space` to drop, `Esc` to cancel. This is the single largest a11y risk in a Kanban product; dnd-kit provides it, and it must not be disabled.
- All interactive elements reachable by Tab in logical order; visible focus rings.
- Live regions announce board changes ("Task moved to In Progress") without spamming on every remote event.
- Modals trap focus and restore it on close.
- No information conveyed by colour alone — priority uses icon + label, not just hue.
- `prefers-reduced-motion` disables card transitions.

---

## 25. Performance Requirements

| Metric | Target |
|---|---|
| LCP (board) | < 2.5s on 4G |
| INP | < 200 ms |
| Drag visual feedback | < 50 ms p95 |
| API read p95 | < 300 ms |
| API write p95 | < 500 ms |
| Realtime propagation p95 | < 1s |
| Analytics query p95 | < 1.5s (pre-aggregated) |
| JS bundle, board route | < 250 KB gzipped |

---

## 26. Security Requirements

Summarised here; specified fully in `07_security_spec.md`. Row Level Security on every table; deny by default; server-side authorization on every mutation regardless of client checks; no user-controlled HTML rendered unsanitised; rate limiting on auth and write endpoints; secrets never in client bundles.

---

## 27. Analytics and KPIs

**Product KPIs:** signup → first task conversion; D7/D30 project retention; weekly active projects; median tasks created per active project per week; analytics tab adoption.

**Engineering KPIs:** API error rate <0.5%; realtime reconnect rate; optimistic-update rollback rate (a proxy for backend reliability); p95 latencies above.

---

## 28. Success Criteria

MVP is successful if a real 5-person team runs a real project on it for four consecutive weeks without reverting to a spreadsheet, with no data-loss incident, and can produce a cycle-time trend at the end of it.

---

## 29. Risks and Mitigations

See `00 §9`. Additional product-level risks:

| Risk | Mitigation |
|---|---|
| Users expect Asana features and churn | Position explicitly as "simple by design"; Non-Goals stated in marketing copy |
| Notification fatigue causes email mute, killing the digest | Batching + granular categories + digest defaults to weekly, not daily |
| Analytics misread (mean vs median confusion) | Label metrics precisely; show sample size next to every aggregate |

---

## 30. Open Questions

Carried from `00 §7`: M1 task ceiling, M2 data residency, M3 Viewer role in MVP, M4 email domain and DNS access, M5 retention window, M6 portfolio vs production bar.

Additional: Should the weekly digest be per-project or one combined email per user across projects? *(Recommendation: per-user combined — reduces volume, but requires cross-project aggregation.)*

---

## 31. Assumptions

A1–A8 as listed in `00 §8`. All are architecture-affecting; each must be revalidated before scaling beyond the stated limits.

---

## Final Deliverable Summary

**Final MVP feature list**
Auth (email + Google) · Projects · Roles & invitations · Columns · Tasks (assignee, due date, priority, labels) · Drag & drop with keyboard equivalent · Realtime sync · Comments & mentions · Subtasks · Filters & search · Activity log · Notifications · Weekly deterministic summary · Analytics dashboard · Dark mode · Soft delete.

**Final user roles**
Owner · Admin · Member · Viewer.

**Final major workflows**
Onboarding to first task (J1) · Daily contributor loop (J2) · Lead review loop (J3) · Invitation acceptance (J4).

**Open decisions blocking development**
M2 (region — irreversible), M3 (Viewer in scope — affects RBAC and RLS policy count), M4 (email domain — blocks invitations and digest), M5 (retention — blocks purge job).

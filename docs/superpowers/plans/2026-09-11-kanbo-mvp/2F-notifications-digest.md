# Kanbo Sub-plan 2F — Notifications, email & digest (P1)

> **Status: task-level.** Expand this file to step-level (bite-sized TDD steps with code) using `superpowers:writing-plans` immediately before execution, then run it with `superpowers:subagent-driven-development`. Do not start until Sub-plan 2E has shipped to staging with CI green.
>
> **Read first:** `00-master-roadmap.md` §2 (Gap Register — the G*/T* ids referenced below), §4 (cross-cutting rules, including the security-property requirement for auth/membership/token tasks), and the *Interfaces* blocks of the previous sub-plans — every task here consumes `withApiHandler` / `mapRpcError` (`src/lib/api/handler.ts`), `RATE_LIMITS` (`src/lib/api/rate-limit.ts`), `createAdminClient` (`src/lib/supabase/admin.ts`), `seedIsolationFixture` (`src/test/rls/setup.ts`) and `log` (`src/lib/log.ts`) from 2A.
>
> **Commit rule:** Conventional Commits, no AI co-author or session trailers.

**Spec:** `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md` + `docs/specs/00`–`07`; `00-master-roadmap.md` §5 Sub-plan 2F.

**Definition of done:** every task's acceptance tests green; new tables covered by the RLS isolation suite; `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build && npm run size` green; preview deployment on staging exercised manually; CI green on the PR.

---

## Tasks

**Task 2F.1 — Notification tables + fan-out RPC**
- Files: migration per `04 §4.12` (`notifications`, `notification_queue`, `notification_preferences`, `users.email_undeliverable_at` (G13)), RLS (user reads own; inserts only via RPC), `enqueue_notifications(p_type, p_project_id, p_task_id, p_actor_id, p_recipient_ids, p_payload)` — honours preferences, skips actor (no self-notify), writes in-app rows + queue rows with `send_after = now() + 5 min`; publication add `notifications`.
- Callers (post-commit, `03 §4` step 6): `create_task`/`update_task` (assignment), `create_comment` (mentions + watchers per G1), `move_task` (status change to watchers).
- Acceptance: SQL tests — actor never notified; muted category skipped; a burst of 10 assignments → 10 in-app rows, queue rows share one window.

**Task 2F.2 — Cron plumbing (T1)**
- Files: migration enabling `pg_cron` + `pg_net`, `job_runs` table (from 2C.2), `src/app/api/cron/[job]/route.ts` guarded by `CRON_SECRET` bearer + constant-time compare, using service-role client; `pg_cron` schedules calling `pg_net.http_post` for `notification-flush` (every 5 min) and `weekly-digest` (hourly, job decides who is at Monday 09:00 local).
- Security: 401 on missing/wrong secret with no timing leak; endpoint idempotent on `run_key`; secret only in server env.
- Acceptance: unit tests for guard; integration: duplicate trigger for same `run_key` is a no-op.

**Task 2F.3 — Flush job + batching**
- Files: `src/lib/notifications/flush.ts` — select due queue rows grouped by user, one email per user per window, mark `sent_at`, `attempts++` and `last_error` on failure with backoff (`send_after += 2^attempts min`, max 5), skip `email_undeliverable_at`.
- Acceptance: unit tests with fake `EmailSender`: 10 rows → 1 send; failure → retried; 6th failure → dead (logged, Sentry).

**Task 2F.4 — Due-soon scan (`03 §13`)**
- Files: `pg_cron` hourly plpgsql: tasks due within 24h in project tz, not done, assignee set, not already notified (`notifications` unique partial index on `(task_id, type, user_id, payload->>'dueDate')`).

**Task 2F.5 — Notification centre UI + preferences + unsubscribe (G12)**
- Files: `src/components/notifications/bell.tsx` (unread count via realtime), `notification-list.tsx`, routes per `05 §13`; Account Settings page (S9: profile, password, notification prefs, theme — G6); `src/app/unsubscribe/route.ts` + `src/lib/email/unsubscribe-token.ts` (HMAC, expiry, constant-time verify).
- Security: unsubscribe token can only set one category to off, never read data; 30-day expiry.

**Task 2F.6 — Weekly digest (FR-9, G2)**
- Files: migration `weekly_summary(p_project_id, p_week_start)` SQL (completed w/ titles, created, went-overdue, due next week, per-member) — pure SQL, no LLM; route `GET /projects/:id/summary/weekly`; `src/lib/digest/build.ts` renders one email per project; the hourly digest cron selects projects where it is Monday 09:00–09:59 in `projects.timezone` and no `job_runs` row exists for `(weekly_digest, project_id:week_start)`, then enqueues one email per opted-in member via `EmailSender` with an unsubscribe link (G12); S5 panel on board + analytics; "quiet week" variant.
- Acceptance: reconciliation test — counts equal `activity` counts for a seeded week (`01 §FR-9`); quiet week snapshot; project in `Asia/Kolkata` fires at 03:30 UTC and never twice for the same week; muted member receives nothing.

**Task 2F.7 — Resend adapter (when M4 unblocks)**
- Files: `src/lib/email/resend-sender.ts`, webhook `POST /api/webhooks/resend` (signature verify, sets `email_undeliverable_at`). Provision via Vercel Marketplace. Optional in this cycle; interface already in place.

---

---

## Verification (sub-plan exit)

See `00-master-roadmap.md` §6. Playwright flows relevant to this sub-plan are listed there; add the ones this sub-plan enables to `e2e/` when Playwright is introduced (first needed in 2B.4).

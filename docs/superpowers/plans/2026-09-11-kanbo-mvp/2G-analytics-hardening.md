# Kanbo Sub-plan 2G — Snapshots, analytics & final hardening

> **Status: expanded to step-level.** This file is now a quick-reference index of the seven tasks; the executable, step-by-step plan (failing test → code → passing test → commit for each step) lives in two files:
> - `2G-analytics-hardening-1.md` — Task 2G.1 through Task 2G.4 (board_snapshots job, analytics SQL + routes, analytics dashboard UI, purge job)
> - `2G-analytics-hardening-2.md` — Task 2G.5 through Task 2G.7 (account deletion, CSP nonce + security acceptance run, production launch — closes out the MVP)
>
> Run those two files in order with `superpowers:subagent-driven-development`. Do not start until Sub-plan 2F has shipped to staging with CI green.
>
> **Read first:** `00-master-roadmap.md` §2 (Gap Register — the G*/T* ids referenced below), §4 (cross-cutting rules, including the security-property requirement for auth/membership/token tasks), and the *Interfaces* blocks of the previous sub-plans — every task here consumes `withApiHandler` / `mapRpcError` (`src/lib/api/handler.ts`), `RATE_LIMITS` (`src/lib/api/rate-limit.ts`), `createAdminClient` (`src/lib/supabase/admin.ts`), `seedIsolationFixture` (`src/test/rls/setup.ts`) and `log` (`src/lib/log.ts`) from 2A.
>
> **Commit rule:** Conventional Commits, no AI co-author or session trailers.

**Spec:** `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md` + `docs/specs/00`–`07`; `00-master-roadmap.md` §5 Sub-plan 2G.

**Definition of done:** every task's acceptance tests green; new tables covered by the RLS isolation suite; `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build && npm run size` green; preview deployment on staging exercised manually; CI green on the PR.

---

## Tasks

**Task 2G.1 — `board_snapshots` job (ships before the dashboard, `00 §9`)**
- Files: migration table per `04 §4.11` (unique `(project_id, column_id, snapshot_date)`), plpgsql `board_snapshot()` on `pg_cron` 00:05 UTC, `on conflict do nothing`, `job_runs` row; Sentry cron-monitor check-in from a tiny `/api/cron/snapshot-heartbeat` (or Supabase log alert) so a silent miss alerts (`03 §16`).
- Acceptance: run twice same day → one row set; test asserts alert path fires when `job_runs` lacks today's row.

**Task 2G.2 — Analytics SQL + routes (`05 §12`)**
- Files: migration functions `analytics_throughput`, `analytics_cycle_time` (median/p25/p75, buckets < 3 → null, G4), `analytics_cumulative_flow` (null for gap dates — never interpolated), `analytics_workload`, `analytics_summary`; routes with `sampleSize` everywhere; rate limit 30/min; `Cache-Control: private, max-age=300` (T16).
- Acceptance: seeded-fixture tests with known answers; reopened-then-completed task uses latest completion (`01 §23`).

**Task 2G.3 — Analytics dashboard UI (S4)**
- Files: `src/app/(app)/p/[projectId]/analytics/page.tsx`, `src/components/analytics/*` (Recharts: throughput bar, cycle-time line, CFD stacked area with visible gaps, workload bar; stat tiles with `n=`), per-chart error boundaries, "insufficient data" card (<2 weeks), date-range selector.
- Acceptance: component tests for insufficient-data and gap rendering; a11y: charts have text summaries.

**Task 2G.4 — Purge job (M5) + retention**
- Files: `purge_soft_deleted()` daily 03:00 — hard-deletes tasks/columns/projects/comments with `deleted_at < now() - 30 days`, sent queue rows > 7 days, notifications > 90 days, expired invitations > 30 days, idempotency keys > 24 h.
- Acceptance: fixture with old and fresh rows; only old rows gone; `activity` untouched.

**Task 2G.5 — Account deletion (G6)**
- Files: RPC `delete_own_account()` — refuses if sole Owner anywhere (lists projects), else anonymises `users` row, deletes memberships (unassign + activity), signs out; `DELETE /api/v1/users/me`; Danger zone UI with typed confirmation.
- Security: session invalidated; `actor_id` preserved on activity.

**Task 2G.6 — CSP nonce (T6) + security acceptance run**
- Files: `middleware.ts` generates nonce, sets `Content-Security-Policy` per request; `next.config.ts` static headers keep the rest; remove `'unsafe-inline'` for scripts in production.
- Acceptance: walk `07 §18` items 1–12 with evidence (test names / CI job links) in `docs/security-acceptance.md`.

**Task 2G.7 — Production launch**
- `db push` to `kanbo-prod`, promote Vercel production, uptime check (free tier of any uptime monitor hitting `/`), verify nightly dump artifact exists for prod and one restore drill into `kanbo-dev` is logged (T17), README/runbook updates.

---

## Verification (sub-plan exit)

See `00-master-roadmap.md` §6. Playwright flows relevant to this sub-plan are listed there; add the ones this sub-plan enables to `e2e/` when Playwright is introduced (first needed in 2B.4).

# Kanbo — Implementation Roadmap to MVP

> **For agentic workers:** This is the master roadmap. Each sub-plan lives in its own file in this folder and is executed with `superpowers:subagent-driven-development`, one at a time, in order. `2A` is already written at step level (code included). `2B`–`2G` are written at task level (files, interfaces, security properties, acceptance tests) and are expanded to step level with `superpowers:writing-plans` immediately before execution — the codebase changes under each sub-plan, and a step-level plan written six sub-plans early goes stale.
>
> **Files in this folder**
>
> | File | Sub-plan | Detail level |
> |---|---|---|
> | `00-master-roadmap.md` | this document — gap register, sequence, cross-cutting rules | — |
> | `2A-platform-hardening.md` | Platform hardening & delivery | step-level (execute now) |
> | `2B-members-invitations.md` | Members, roles & invitations | task-level |
> | `2C-board-completion.md` | Board completion | task-level |
> | `2D-comments-labels.md` | Comments, mentions & labels | task-level |
> | `2E-filters-search.md` | Filters, search & My Tasks | task-level |
> | `2F-notifications-digest.md` | Notifications, email & digest | task-level |
> | `2G-analytics-hardening.md` | Snapshots, analytics & final hardening | task-level |
>
> **Commit rule (all sub-plans):** Conventional Commits, the user's own git identity only — **no `Co-Authored-By` or `Claude-Session` trailers** (`ENGINEERING_RULES.md §7`, confirmed by the user 2026-09-11).

**Goal:** Take Kanbo from its current state (auth + projects + board + realtime, single-user-per-project in practice) to the MVP defined in `docs/specs/01_prd.md §14`: a multi-member, real-time Kanban with comments, labels, filters, notifications, a deterministic weekly digest and an analytics dashboard — deployed to production with CI, RLS tests and observability.

**Architecture (decided):** Keep what is built. Transactional business rules stay in Postgres `security definer` RPCs (`supabase/migrations/*`); Next.js Route Handlers stay thin (Zod → `rpc()` → error map) and share one helper for the repeated auth/origin/error boilerplate. Browser reads go straight through RLS; Supabase Realtime pushes changes with `mutation_id` echo suppression (`src/lib/realtime/board-sync.ts`). This deviates from `03 §4` (service/repository layering) and is recorded in the build-decisions doc in Sub-plan 2A.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind 4, shadcn/ui, Supabase (Auth, Postgres, Realtime, pg_cron, pg_net), Zod, Vitest + Testing Library, Playwright, dnd-kit, Recharts, date-fns, react-markdown + rehype-sanitize, Sentry, GitHub Actions, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md` + `docs/specs/00`–`07` (authoritative). This roadmap adds the **Gap Register** (§2) — decisions the specs left open — and each resolution becomes binding once this plan is approved.

---

## 1. Where we are (verified against the repo, 2026-09-11)

**Built and committed on `feat/foundation`** (5 feature commits, 7 test files, 9 migrations):

| Area | State |
|---|---|
| Auth (email + Google, verify gate, reset) | Done — `src/app/(auth)/*`, `src/app/actions/auth.ts`, `middleware.ts` |
| Schema: users, projects, memberships, invitations, columns, tasks, subtasks, activity + RLS | Done — `supabase/migrations/202609090001_data_core.sql` |
| Transactional RPCs: create/move/update/soft-delete task, update project, subtasks, columns | Done — migrations 0002–0008 |
| Projects list/create/settings, workflow (columns) settings | Done — `src/components/projects/*` |
| Board with native HTML5 drag, inline composer, task editor modal, subtasks | Done — `src/components/board/project-board.tsx` (962 lines) |
| List view, activity feed | Done (basic) |
| Realtime sync with echo suppression, degraded/read-only state | Done — `src/lib/realtime/*`, `202609100001_realtime.sql` |
| Dark mode (next-themes + toggle) | Done |
| Security headers / CSP | Done, but CSP uses `'unsafe-inline'` for scripts (spec: nonce) |

**Not built (P0 per `01 §13`):** members & invitations (tables exist, zero routes/UI), roles UI, assignee (no UI; `users` RLS only allows reading yourself, so teammates' names are unreadable), keyboard drag-and-drop (a11y hard requirement `01 §24`), fractional-index renormalisation, task restore, column delete-with-choice, project archive/delete/leave/transfer-ownership, optimistic concurrency (`expectedUpdatedAt`), idempotency keys, rate limiting, CI pipeline, Playwright, RLS negative tests, Sentry, staging/prod environments, Vercel deploy.

**Not built (P1 / Phase 2):** comments + mentions, labels, filters + search, My Tasks, notifications, weekly digest, `board_snapshots` job, analytics dashboard, purge job, account settings, `EmailSender`.

---

## 2. Gap Register — what the PRD and specs left open

Each row is a decision this plan makes. Change any of them before approval; after approval they are binding on the sub-plans.

### 2.1 Product / requirement gaps

| # | Gap | Decision |
|---|---|---|
| G1 | **"Watched task"** notifications (`01 §18`, FR-11) — no `task_watchers` table exists in `04`. What does "watched" mean? | Implicit watchers = task creator + current assignee + anyone who has commented. No explicit watch/unwatch in MVP. Notification fan-out computes this set at write time. |
| G2 | **Digest per-project vs per-user** (`01 §30` unresolved). | **Per-project**, sent Monday 09:00 in `projects.timezone` to every member not opted out (FR-9 literal). One email per project per member. In-app panel (S5) per-project. |
| G3 | **Timezone for "overdue" / "today" / "this week."** `users.timezone` and `projects.timezone` both exist; `due_date` is a `date`. | Due-state is evaluated in the **project** timezone (the board is the shared truth; two teammates must agree on what is overdue). `users.timezone` is used only for rendering timestamps and choosing the user's digest send hour. |
| G4 | **Cycle time when a column's `is_in_progress_column` flag changes later.** | Evaluate against column flags **at query time** (current flags). Simple, deterministic, documented in the analytics page footnote. |
| G5 | **My Tasks view** (persona P2, J2, pain-point table) is never listed as an FR or in any phase. | Add as `/my-tasks`: cross-project list of open tasks assigned to me, grouped by due state. Ships in 2E (needs assignee + filters). |
| G6 | **Account settings (S9)** and `DELETE /users/me` (`05 §4`, `04 §14` PII anonymisation) are in the UX/API specs but in no phase. | Profile + password + notification preferences + theme ship in 2F. Account deletion ships in 2G with anonymisation (`display_name → "Deleted user"`, email → tombstone, `actor_id` retained per `04 §4.10`). Blocked while the user is sole Owner of any project (BR-1). |
| G7 | **Mention syntax** undefined. | Stored body uses `@[Display Name](uuid)`; renderer turns it into a chip; server recomputes `mentioned_user_ids` from the body and intersects with current membership (client-supplied ids are ignored). |
| G8 | **Presence indicator** (`02 §S1` lists `RealtimePresenceIndicator`) is not in any FR. | Out of MVP. Cheap later via Supabase Presence on the existing channel. |
| G9 | **`activity_action` enum lacks `commented`** (`04 §4.10` lists it; migration 0001 omitted it). | Add in the comments migration (`alter type … add value`). |
| G10 | **Search server-side threshold** (`FR-7` "beyond the threshold via indexed query") vs A1 (<500 tasks, no pagination). | MVP filters and search are **client-side only** over the already-loaded board; state lives in the URL. No `pg_trgm` index until A1 is revalidated. |
| G11 | **Invitation acceptance when signed-out** (J4): the token must survive signup → email verification → callback. | Store the token in a short-lived httpOnly cookie (`kanbo_invite`, 1h) on `/invite/:token`; `/auth/callback` reads and clears it and redirects to `/invite/:token` after verification. |
| G12 | **Unsubscribe link** on every non-transactional email (`01 §18`) — no spec for how. | Signed, single-purpose token (HMAC-SHA256 of `user_id:category` with a server secret, 30-day expiry) → `GET /unsubscribe?t=…` → sets `notification_preferences.email=false`. No login required. |
| G13 | **Email bounces** (`03 §14`) need an "undeliverable" flag; `users` has none. | Add `users.email_undeliverable_at timestamptz`. Set by the Resend webhook (when Resend lands); flush job skips such users. |
| G14 | **Deep links** from notifications/digest to a task. | Canonical URL `/p/:projectId/board?task=:taskId`; the board opens the modal from the query param. |

### 2.2 Technical / infrastructure gaps

| # | Gap | Decision |
|---|---|---|
| T1 | **Vercel Hobby cron limits** — `03 §13` schedules a 5-minute flush and hourly scans on Vercel Cron, but Hobby allows only daily crons. M6 says free tier for compute. | **All schedules run on `pg_cron` inside Supabase.** Pure-SQL jobs (`board_snapshot`, `purge_soft_deleted`, `renormalize_positions`, `due_soon_scan`) are plpgsql. Jobs that must send email (`notification_flush`, `weekly_digest`) are triggered by `pg_cron` → `pg_net` HTTP POST to `/api/cron/<job>` with a `CRON_SECRET` bearer header. Every job writes a `job_runs (job_name, run_key, started_at, finished_at, error)` row with `unique(job_name, run_key)` for idempotency. |
| T2 | **Rate limiting store** — no Redis; Vercel WAF rate limiting is Pro-only. | Postgres fixed-window counters: table `rate_limits (key text, window_start timestamptz, count int, pk(key, window_start))` + RPC `consume_rate_limit(key, limit, window_seconds) → (allowed, remaining, reset_at)`. Called from the shared route helper. Supabase Auth's own built-in limits cover `/auth/*`; we add app-level limits per `05 §2` for invitations (20/h/user), writes (100/min/user), analytics (30/min/user). |
| T3 | **Idempotency-Key** (`05 §2`) needs 24h response storage. | Table `idempotency_keys (user_id, key, request_hash, status, response jsonb, created_at)`, pk `(user_id, key)`. Applied to task create and invitation create only (the two the spec calls required). Purged by the daily purge job. |
| T4 | **RLS negative tests without Docker** — `supabase test db` (pgTAP) needs a local stack; memory says no Docker locally. | RLS acceptance suite is a **Vitest integration suite** (`src/test/rls/*.test.ts`) run against `kanbo-dev` locally and `kanbo-staging` in CI: service-role client seeds users A/B + project, two anon clients sign in as A and B, assert B gets zero rows / 404 / 403 on every table and write endpoint. Meets `07 §18` items 1, 2, 4, 5, 12. Tagged `@integration`, separate npm script, requires env. |
| T5 | **`users` RLS blocks reading teammates** (`users_self` only) → assignee pickers, avatars, activity actors all break for multi-member projects. | New policy `users_project_peers`: `exists(select 1 from memberships a join memberships b on a.project_id = b.project_id where a.user_id = auth.uid() and b.user_id = users.id)`. Exposes `id, display_name, avatar_url` only via a `public.project_peers` view; email stays private. |
| T6 | **CSP `'unsafe-inline'` scripts in production** (spec `07 §5`: nonce-based). | Move CSP generation into `middleware.ts` with a per-request nonce; Next.js picks it up from the `x-nonce` header. Deferred to 2G (hardening) — it touches every page and is best done once the UI surface is stable. |
| T7 | **Function region** — data in `ap-south-1`; Vercel functions default to `iad1`, adding ~200 ms per DB round trip against the 300 ms p95 budget. | Set Vercel function region to `bom1` in `vercel.ts`. |
| T8 | **Playwright + email verification gate** — E2E cannot sign up through the real flow. | Test users are created confirmed via the Supabase Admin API (service role) in a global setup against `kanbo-staging`; tests log in with password. |
| T9 | **HaveIBeenPwned check** (`07 §2`) | Supabase Auth "leaked password protection" is Pro-only. **Decision: free tier only, permanently (M6 amended).** We implement the HIBP k-anonymity range check ourselves in the signup/reset server actions (`src/lib/auth/breach-check.ts`, SHA-1 prefix → `api.pwnedpasswords.com/range/`, 2 s timeout, fail-open with a Sentry warning so an HIBP outage never blocks signup). |
| T17 | **Backups on free tier** — Supabase free has no automated backups and no PITR; `03 §19–22` assumed daily backups (RPO 24 h). Free projects also pause after 7 days without API traffic. | Nightly GitHub Actions job runs `supabase db dump` (schema + data) against prod and stores it as an encrypted artifact (90-day retention) — restore drill = load the dump into `kanbo-dev`. The same workflow pings staging/dev REST endpoints so they never pause; prod stays awake through real traffic and the cron routes. RPO stays 24 h. |
| T10 | **Markdown sanitiser** — spec says DOMPurify, which needs a DOM and cannot run in Server Components. | `react-markdown` + `rehype-sanitize` with an explicit allowlist schema (formatting, lists, links, code). ESLint rule bans `dangerouslySetInnerHTML`. |
| T11 | **Native HTML5 drag** has no keyboard path; `01 §24` mandates one and names dnd-kit. | Replace the board's drag layer with `@dnd-kit/core` + `@dnd-kit/sortable`, keyboard sensor on, screen-reader announcements throttled. |
| T12 | **Realtime for memberships/notifications/comments** — publication only has `tasks` and `columns`. | Add `memberships` (so a removed member's client closes the channel and redirects — `07 §18.6`), `comments`, `notifications` to the publication with `replica identity full`. |
| T13 | **Coverage gate** (`01 §12` ≥70% on business logic) not configured. | `@vitest/coverage-v8`, threshold on `src/lib/**`, enforced in CI. |
| T14 | **Git attribution** — `ENGINEERING_RULES.md §7` forbids AI co-author trailers; existing commits carry them. | From now on: no trailers. Existing history left as-is. |
| T15 | `.gitattributes` missing (CRLF churn on Windows). | Add `* text=auto eol=lf`. |
| T16 | Analytics caching (`03 §12` Next.js Data Cache, 5 min). | Not at MVP. Queries are indexed and bounded by A1; add `Cache-Control: private, max-age=300` on analytics routes only. Revisit if p95 > 1.5 s. |

---

## 3. Build sequence

Seven sub-plans. Each produces working, deployable software and ends with the app on staging. Order is driven by dependencies: members before comments (mentions need members), snapshots before analytics (`00 §9`), notifications before digest (shared queue + `EmailSender`).

```
2A  Platform hardening & delivery     CI, envs, deploy, shared route helper, rate limits, Sentry
2B  Members, roles & invitations      the missing P0 core; unlocks everyone else
2C  Board completion                  dnd-kit, keyboard DnD, assignee, restore, column ops, concurrency
2D  Comments, mentions & labels
2E  Filters, search & My Tasks
2F  Notifications, email & digest     EmailSender, queue, pg_cron jobs, prefs, account settings
2G  Snapshots, analytics & final hardening   board_snapshots first, dashboard, purge, CSP nonce, account deletion
```

Rough effort: 2A 2–3 days · 2B 3 days · 2C 3–4 days · 2D 2–3 days · 2E 2 days · 2F 3–4 days · 2G 3–4 days.

---

## 4. Cross-cutting rules (apply to every task in every sub-plan)

- TDD: failing test → minimal code → pass → commit. Conventional Commits, **no AI trailers** (T14).
- Every write: Zod on the boundary → RPC (auth + role + validation + mutation + `activity` insert in one transaction) → error-code map. New RPCs follow `move_task`'s shape exactly (`202609090003_move_task.sql`): `auth.uid()` null check, `for update` lock, `can_write_project`/role check, raise with `errcode`, `revoke … from public; grant … to authenticated`.
- Every project-scoped 404-vs-403: non-members get **404** (`05 §2`).
- Every new table: RLS enabled, deny by default, explicit policies, added to the RLS integration suite in the same task.
- Every new RPC: `security definer`, `set search_path = public`, execute revoked from `public`.
- **Security-sensitive tasks** (anything touching invitations, membership, ownership, account deletion, unsubscribe, cron endpoints) must list their security properties in the task's Interfaces block and have a test per property. Minimum set: no enumeration (identical responses/timings for exist vs not-exist), rate limited at both per-user and per-IP scope where unauthenticated, explicit max lengths on every string before it reaches hashing/crypto, generic error copy, single-use tokens consumed in the same transaction as their effect.
- No `NEXT_PUBLIC_` secret. `SUPABASE_SERVICE_ROLE_KEY` is used **only** by cron routes, the RLS test seeder and the account-deletion RPC caller.
- Structured JSON logs with `request_id`; never log tokens, emails, comment bodies.
- Docs: update `README.md` and `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md` when a decision in §2 lands.

---

## 5. Sub-plans

Each task below lists: **Files**, **Interfaces** (consumes/produces), **Security properties** where relevant, and **Acceptance tests**. The expanded writing-plans doc adds the step-level code.

### Sub-plan 2A — Platform hardening & delivery

**Purpose:** Everything after this ships to a real staging URL through CI. Done first so every later sub-plan ends deployed.

**Task 2A.1 — Shared route helper**
- Files: create `src/lib/api/handler.ts`, `src/lib/api/handler.test.ts`; modify every `src/app/api/v1/**/route.ts` to use it.
- Produces: `withApiHandler(opts: { schema?: ZodSchema; rateLimit?: { key: string; limit: number; windowSeconds: number } }, fn: (ctx: { user: User; supabase: SupabaseClient; body: T; params: P; requestId: string }) => Promise<Response>)`; `mapRpcError(error): Response` (P0002→404, 42501→403 (or 404 when project-scoped), 22023→422, 23505→409, else 500 with `requestId`).
- Acceptance: unit tests for each error-code mapping; origin mismatch → 403; unauthenticated → 401; existing route tests still pass; behaviour of every existing route unchanged (diff is mechanical).

**Task 2A.2 — Rate limiting (T2)**
- Files: `supabase/migrations/2026091101_rate_limits.sql` (table + `consume_rate_limit` RPC, service-role only), `src/lib/api/rate-limit.ts` + test; wire into `withApiHandler`.
- Produces: `X-RateLimit-Limit/Remaining/Reset` headers; 429 with `RATE_LIMITED` code (add to `ApiErrorCode` in `src/lib/api/response.ts`).
- Security properties: keyed by user id when authenticated, by IP (`x-forwarded-for` first hop) when not; counters are server-side only.
- Acceptance: integration test — 101st write in a minute → 429; window resets.

**Task 2A.3 — Environments: `kanbo-staging`, `kanbo-prod`, Vercel project**
- Files: `vercel.ts` (`framework: nextjs`, `regions: ['bom1']`, no crons), `.env.example` additions (`CRON_SECRET`, `UNSUBSCRIBE_SECRET`), `README.md`.
- Operator steps (handed to user, interactive): create two Supabase projects in `ap-south-1`, `npx supabase link` per env, `db push`, configure Auth redirect URLs + Google OAuth client per env, create Vercel project, set env vars per environment (preview → staging keys, production → prod keys).
- Acceptance: `vercel deploy` preview boots against staging; login works.

**Task 2A.4 — CI pipeline**
- Files: `.github/workflows/ci.yml`, `.gitattributes` (T15), `vitest.config.mts` coverage config (T13), `package.json` scripts `test:rls`, `test:coverage`, `size`.
- Pipeline on PR: typecheck → lint → unit + coverage (≥70% on `src/lib`) → `npm audit --audit-level=high` → gitleaks → build → bundle-size check (`@next/bundle-analyzer` JSON, board route < 250 KB gz) → RLS integration suite against staging (secrets) → migration dry-run (`supabase db push --dry-run` against staging).
- Acceptance: workflow green on the branch; a deliberately failing test blocks.

**Task 2A.5 — RLS integration suite scaffold (T4)**
- Files: `src/test/rls/setup.ts` (seed A, B, project P owned by A; teardown), `src/test/rls/isolation.test.ts`.
- Produces: `seedIsolationFixture(): Promise<{ a: SupabaseClient; b: SupabaseClient; projectId: string; cleanup(): Promise<void> }>` reused by every later sub-plan.
- Acceptance: for each existing table, B sees zero rows of P; B's `PATCH /api/v1/projects/P` → 404; B's `rpc('move_task')` → error.

**Task 2A.6 — Sentry + structured logging**
- Files: `sentry.{client,server,edge}.config.ts`, `next.config.ts` (`withSentryConfig`), `src/lib/log.ts` (+ test), `src/app/error.tsx` shows `requestId`.
- Acceptance: thrown error in a route appears with `request_id` tag; log line shape asserted in test; no PII fields.

**Task 2A.7 — Backups + keep-alive (T17)**
- Files: `.github/workflows/backup.yml` (nightly `npx supabase db dump --linked` for prod → encrypted artifact; curl ping to dev/staging `/auth/v1/health`), `docs/runbook.md` (restore procedure into `kanbo-dev`).
- Acceptance: workflow produces an artifact; one manual restore drill completed and logged before 2G.7.

**Task 2A.8 — Password breach check (T9)**
- Files: `src/lib/auth/breach-check.ts` + test (`isBreachedPassword(password): Promise<boolean>` — SHA-1, send 5-char prefix only, suffix match; 2 s timeout; on network error return `false` and log a warning), wired into `signUp` and `resetPassword` in `src/app/actions/auth.ts` with the copy "This password appeared in a data breach. Choose another."
- Security properties: full hash never leaves the server; password max length 128 enforced before hashing; identical response timing whether or not the email exists is preserved (check runs before the Supabase call in both branches).
- Acceptance: unit tests with a mocked range response (hit / miss / timeout fail-open).

**Task 2A.9 — Record decisions**
- Files: `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md` (append §2 of this roadmap: RPC architecture, pg_cron, rate-limit store, RLS test strategy, free-tier-only M6 amendment, per-project digest, git attribution).

---

### Sub-plan 2B — Members, roles & invitations (P0)

**Task 2B.1 — Peer visibility (T5)**
- Files: migration `users_project_peers` policy + `project_peers` view; RLS test.
- Acceptance: B in P sees A's `display_name`, not A's email; non-member sees nothing.

**Task 2B.2 — `EmailSender` interface + console adapter (M4)**
- Files: `src/lib/email/sender.ts` (`interface EmailSender { send(msg: { to: string; subject: string; text: string; html: string; category: 'transactional' | 'notification' | 'digest' }): Promise<{ id: string }> }`), `src/lib/email/console-sender.ts`, `src/lib/email/index.ts` (`getEmailSender()` picks by `EMAIL_PROVIDER` env: `console` | `resend`), templates in `src/lib/email/templates/*.ts` (plain functions returning `{subject,text,html}`; React Email deferred).
- Acceptance: console adapter logs a redacted line (`to` hashed), returns id; template snapshot tests.

**Task 2B.3 — Invitations: create / list / revoke**
- Files: migration `2026091102_invitations.sql` (RPCs `create_invitation(p_project_id, p_email, p_role, p_token_hash)`, `revoke_invitation`), routes `POST/GET /api/v1/projects/[projectId]/invitations`, `DELETE …/invitations/[invitationId]`, `src/lib/invitations/schemas.ts`, `src/lib/invitations/token.ts` (`generateInviteToken(): { token: string; hash: string }` — 32 bytes CSPRNG, base64url, SHA-256).
- Security properties: only hash stored; Owner/Admin only; cannot grant ≥ own role (BR-2); re-invite pending email is idempotent (returns existing, resends); existing member → 409; rate limit 20/h/user; email max length 254 before hashing; Idempotency-Key honoured (T3, table + `withApiHandler` option).
- Acceptance: unit tests for token; RLS/integration tests for each security property; email sender called once with a link `${SITE_URL}/invite/${token}`.

**Task 2B.4 — Invitation acceptance (J4, S11, G11)**
- Files: migration `accept_invitation(p_token_hash)` (validates hash, expiry, unused; requires `auth.jwt()->>'email_verified'`; email match on citext; inserts membership + sets `accepted_at` + activity `member_added` in one txn), `decline_invitation`; pages `src/app/invite/[token]/page.tsx` (public: shows inviter, project, role — read via a `security definer` RPC `peek_invitation(p_token_hash)` returning only those three fields), accept/decline server actions; `src/app/auth/callback/route.ts` reads/clears `kanbo_invite` cookie; signup form accepts `?email=` prefill and locks the field.
- Security properties: 410 on expired/used; 403 on email mismatch (never reveals whether the invite exists to a mismatched user beyond "not for this account"); token never logged; lookup by hash only; single-use consumed in the same transaction; `peek` leaks nothing about other invitations.
- Acceptance: integration tests for each; E2E: signed-out invite → signup prefilled → verify → lands on board as member.

**Task 2B.5 — Members: list, change role, remove, leave**
- Files: migration `change_member_role`, `remove_member` (deletes membership, unassigns their open tasks with `unassigned` activity rows, `member_removed` activity — BR-5), routes `GET /api/v1/projects/[projectId]/members`, `PATCH|DELETE …/members/[userId]`; realtime publication add `memberships` (T12); `use-project-channel.ts` subscribes to own-membership delete → close channel, redirect to `/projects` with toast.
- Security properties: Admin cannot create/modify Owner; cannot demote/remove last Owner (BR-1, enforced by the `memberships_one_owner` unique index plus explicit check); self-leave allowed except Owner; removed member's next request → 404 (`07 §18.6`).
- Acceptance: integration tests per rule; RLS: removed B sees zero rows.

**Task 2B.6 — Transfer ownership, archive, delete project**
- Files: migration `transfer_ownership`, `archive_project`, `soft_delete_project` (cascades `deleted_at` to columns, tasks, comments-later in one txn — BR-8), routes `POST …/transfer-ownership`, `PATCH …` (archive), `DELETE …`.
- Security: Owner only; target must be a member; delete requires typed project-name confirmation client-side and Owner role server-side.
- Acceptance: after delete, member reads return zero rows across all descendant tables (RLS test).

**Task 2B.7 — Members UI (S8 Members tab, S1 invite modal, S3 leave)**
- Files: `src/components/members/members-table.tsx`, `invite-dialog.tsx`, `pending-invitations.tsx`; settings page tab; board header `MemberAvatarStack` + Invite button; project card "Leave".
- Acceptance: component tests (role dropdown disabled for Owner row; Member sees no invite button); E2E invite → accept → appears in table live.

---

### Sub-plan 2C — Board completion (P0)

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

### Sub-plan 2D — Comments, mentions & labels (P1)

**Task 2D.1 — Comments schema + RPCs**
- Files: migration `2026091110_comments.sql`: table per `04 §4.9`, `alter type activity_action add value 'commented'` (G9), RLS (read: member; insert: `can_write_project`; update: author; soft-delete: author or Owner/Admin), RPCs `create_comment`, `update_comment(expected_updated_at)`, `soft_delete_comment`, publication add `comments`.
- Security: Viewer → 403 on write (`07 §18.4`); body 1–5000 enforced in SQL and Zod.

**Task 2D.2 — Mention parsing + sanitised rendering (G7, T10)**
- Files: `src/lib/comments/mentions.ts` (`parseMentions(body): string[]`, `renderMentionsForDisplay`), `src/lib/comments/markdown.tsx` (react-markdown + rehype-sanitize schema), ESLint `no-restricted-syntax` rule banning `dangerouslySetInnerHTML`.
- Acceptance: XSS corpus (script, iframe, `javascript:` href, `onerror`) renders inert (`07 §18.7`); mention of a non-member becomes plain text; ids come from server parse, not client.

**Task 2D.3 — Comment thread UI + mention autocomplete**
- Files: `board/comment-thread.tsx`, `mention-autocomplete.tsx` (peers list), draft preserved on failure (`01 §22`), realtime append.
- Acceptance: component tests; E2E two-browser comment appears live.

**Task 2D.4 — Labels**
- Files: migration `labels`, `task_labels` per `04 §4.8` + RLS + RPCs `set_task_labels(p_task_id, p_label_ids uuid[])` (activity `updated`); routes `GET/POST /projects/:id/labels`, `PATCH/DELETE /labels/:id`; `label-picker.tsx`, chips on cards (name text always shown — no colour-only), Settings → Labels tab.
- Acceptance: duplicate name → 409; colour regex; delete removes associations; RLS isolation.

---

### Sub-plan 2E — Filters, search & My Tasks (P1)

**Task 2E.1 — Filter model + URL state (G10)**
- Files: `src/lib/filters/schema.ts` (Zod: `assignee[]`, `label[]`, `priority[]`, `due ∈ overdue|today|week|none`, `q`), `src/lib/filters/apply.ts` (`applyFilters(tasks, filters, { projectTimezone, now })` — pure; AND across dimensions, OR within; case-insensitive substring on title+description), `use-filter-state.ts` (URL search params, 250 ms debounce on `q`).
- Acceptance: table-driven unit tests incl. timezone edge (G3: 23:30 in `Asia/Kolkata` vs UTC); unknown keys ignored.

**Task 2E.2 — Filter bar, chips, search, shortcuts**
- Files: `board/filter-bar.tsx`, `search-input.tsx`, keyboard `/`, `F`, `N`, `?` (`02 §21`), empty state "No tasks match · Clear filters"; dragged-out card fades rather than vanishes.
- Acceptance: component tests; shortcuts don't fire inside inputs.

**Task 2E.3 — List view parity + inline edit (S6)**
- Files: `src/components/list/task-table.tsx` shares the board's data + filter hook; sortable columns; inline assignee/due/priority.

**Task 2E.4 — My Tasks (G5)**
- Files: `src/app/(app)/my-tasks/page.tsx`, RLS-direct query `tasks where assignee_id = auth.uid()` across projects, grouped by due state in each project's timezone; nav link.

---

### Sub-plan 2F — Notifications, email & digest (P1)

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

### Sub-plan 2G — Snapshots, analytics & final hardening

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

## 6. Verification (end-to-end, per sub-plan and at MVP)

- **Per task:** `npm run test`, `npm run typecheck`, `npm run lint`; RLS suite `npm run test:rls` for any migration; `npm run build`.
- **Per sub-plan:** preview deploy on staging; Playwright flows: J1 (signup → project → task in ≤2 inputs), J4 (invite → accept), J2 (comment → drag → done), J3 (filter overdue → analytics). Two-browser realtime checks for tasks, comments, member removal.
- **MVP gate:** `07 §18` all 12 items evidenced; `01 §25` budgets measured on staging (Lighthouse LCP < 2.5 s, board bundle < 250 KB gz, API p95 via Vercel logs); `board_snapshots` has ≥1 row per project before analytics is exposed; digest reconciliation test green; restore drill completed and logged.

## 7. Out of scope (confirmed)

Attachments, calendar, share links, recurring tasks, timeline, saved filters, CSV export, bulk edit, presence indicator (G8), MFA, i18n, org/tenant entity, AI features.

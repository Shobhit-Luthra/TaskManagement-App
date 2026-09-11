# 03 — System Design / Technical Architecture

**Product:** Kanbo
**Depends on:** `01_prd.md`, `02_ux_ui_spec.md`

---

## 1. Architecture Overview

A **hybrid client-direct / server-mediated** architecture on managed infrastructure.

- **Reads and realtime** go from the browser directly to Postgres via the Supabase client, protected by Row Level Security. This eliminates a network hop and a whole tier of CRUD endpoints.
- **Writes with business logic** — anything involving ordering maths, activity logging, permission escalation, notifications or aggregation — go through Next.js Route Handlers running server-side.

**Why hybrid rather than pure client-direct:** ordering computation, activity-log atomicity and notification fan-out cannot be trusted to a client. A client could write a corrupt `position`, skip the activity insert, or forge an `actor_id`.

**Why hybrid rather than a full custom API:** writing forty CRUD endpoints to re-expose tables that RLS already secures is pure ceremony. It costs weeks and buys nothing.

**Portability note:** all business logic lives in TypeScript Route Handlers, not in Postgres functions or Supabase Edge Functions. If Supabase must be replaced, the data layer moves to any Postgres and the logic is untouched. This is the deliberate hedge against vendor lock-in identified in `00 §9`.

---

## 2. Architecture Diagram (description)

```
┌───────────────────────────────────────────────────────────┐
│ Browser — Next.js App Router (React 19, TypeScript)        │
│  ┌──────────────┬──────────────┬────────────────────────┐ │
│  │ Board UI     │ Board Store  │ Data Layer             │ │
│  │ (dnd-kit)    │ (Zustand)    │ (TanStack Query +      │ │
│  │              │              │  Supabase JS client)   │ │
│  └──────────────┴──────────────┴────────────────────────┘ │
└──────┬─────────────────────────┬────────────────┬─────────┘
       │ reads / realtime (WSS)  │ mutations      │ auth
       ▼                         ▼                ▼
┌──────────────────┐   ┌─────────────────┐  ┌──────────────┐
│ Supabase         │   │ Next.js Route   │  │ Supabase     │
│  Realtime (WS)   │◄──┤ Handlers        │  │ Auth (GoTrue)│
│                  │   │ (Vercel, Node)  │  │ JWT issuer   │
└────────┬─────────┘   └────────┬────────┘  └──────┬───────┘
         │                      │                   │
         ▼                      ▼                   ▼
┌───────────────────────────────────────────────────────────┐
│ PostgreSQL 16 — RLS on every table                        │
│  users · projects · memberships · columns · tasks ·        │
│  comments · labels · activity · board_snapshots ·          │
│  notifications · invitations                               │
└──────────────────────┬────────────────────────────────────┘
                       │ pg_cron
                       ▼
        ┌──────────────────────────────────┐
        │ Scheduled jobs                    │
        │  daily snapshot · weekly digest · │
        │  due-soon scan · purge · renorm   │
        └──────────────┬───────────────────┘
                       ▼
               ┌───────────────┐
               │ Resend (email)│
               └───────────────┘
```

**Explicit note:** no AI/LLM component exists anywhere in this diagram. Per `00 §5`, the summary feature is SQL aggregation. If AI is added in Phase 4, it attaches as a **separate service behind a Route Handler**, never inline in a mutation path.

---

## 3. Frontend Architecture

**Framework:** Next.js 15, App Router, React 19, TypeScript strict.

**Rendering strategy per route:**

| Route | Strategy | Reason |
|---|---|---|
| Landing, auth | Static | No user data, cacheable at the edge |
| `/projects` | Server Component + streaming | Data-dependent but not interactive |
| `/p/:id/board` | Server shell + Client Component | Highly interactive; server-fetches initial state to avoid a loading flash |
| `/p/:id/analytics` | Server Component | Read-heavy, no interactivity beyond range selection |

**State — three distinct layers, deliberately separated:**

1. **Server cache** — TanStack Query. Owns fetched data, caching, refetch and invalidation.
2. **Board interaction state** — Zustand. Owns the in-flight drag, optimistic overlay, and filter state. This is *not* server data and must not live in the query cache; conflating them is what makes optimistic UI unmaintainable.
3. **URL state** — filters, search, open task id. Shareable and back-button friendly.

**Optimistic update pattern:**

```
onDragEnd(event)
  → compute newPosition from neighbours
  → apply to Zustand board store immediately          (renders in <16ms)
  → PATCH /api/v1/tasks/:id/position
  → success: reconcile with server-returned canonical row
  → failure: restore snapshot taken before mutation, animate revert, toast
```

The snapshot is taken **before** the optimistic apply. Rolling back by re-inverting the operation is unreliable once concurrent remote events have arrived.

**Realtime echo handling (challenge C3).** Every mutation the client originates carries a client-generated `mutation_id`. The Route Handler stores it on the row and echoes it in the realtime payload. On receiving an event, the client checks whether the `mutation_id` is in its own in-flight set — if so, it reconciles rather than re-applies. Without this, your own drag arrives back over the websocket and the card jumps twice.

**Performance measures:** `TaskCard` memoised on a shallow task comparison; board store selectors are granular so one card update does not re-render the column; column lists virtualised only if A1 is exceeded; route-level code splitting so the Analytics chart library never loads on the board.

---

## 4. Backend Architecture

Next.js Route Handlers under `/app/api/v1/*`, deployed as serverless functions.

**Layering — enforced, not aspirational:**

```
Route Handler   → parse, authenticate, validate (Zod), map errors to HTTP
   ↓
Service layer   → business rules, orchestration, transactions
   ↓
Repository      → all SQL. Nothing else in the codebase talks to the DB.
```

Route handlers never contain SQL. Services never contain HTTP concerns. This keeps the whole thing testable without a running server and makes the Supabase→other-Postgres migration a repository-layer change.

**Every mutating request follows the same sequence:**

1. Verify JWT → resolve `user_id`
2. Load membership for the target project → authorize role
3. Validate payload against a Zod schema
4. Open transaction
5. Mutate → insert `activity` row → commit
6. Enqueue notifications (outside the transaction)
7. Return the canonical entity

Step 5's coupling is deliberate: the activity insert is inside the transaction, so analytics can never disagree with the board (`01 §FR-8`).

---

## 5. Database Architecture

PostgreSQL 16 (managed). Full schema in `04_database_design.md`. Architectural points:

- **RLS is the authorization boundary**, not a second line of defence. Because the browser holds a Postgres-scoped JWT and queries directly, RLS *is* the perimeter for reads.
- **Two connection identities:** the browser's anon/authenticated role (RLS enforced) and the server's service role (RLS bypassed). The service key never reaches the client bundle. Any accidental exposure is a total compromise — see `07`.
- **Connection pooling** via Supabase's PgBouncer in transaction mode. Serverless functions open connections per invocation; without pooling, a traffic spike exhausts Postgres' connection limit. Transaction-mode pooling forbids session-level features (prepared statements, `SET`), which the repository layer must respect.

---

## 6. Authentication Architecture

Supabase Auth (GoTrue). Email/password with bcrypt, plus Google OAuth.

- JWT access token, 1h expiry; refresh token rotated on use, 30 days.
- Tokens stored in **httpOnly, Secure, SameSite=Lax cookies** via `@supabase/ssr`, not `localStorage`. localStorage is readable by any injected script — an XSS becomes a full account takeover.
- The JWT's `sub` claim is exposed inside Postgres as `auth.uid()`, which every RLS policy keys on. The chain from browser session to row-level filter is therefore cryptographic, not advisory.
- Middleware refreshes sessions on navigation and guards protected routes; the server re-verifies on every API call regardless.

---

## 7. Authorization Architecture

Two enforcement points, both mandatory:

1. **Database (RLS)** — a policy on every table. Deny by default. Covers direct client reads and any application bug that forgets a check.
2. **Service layer** — an explicit `authorize(userId, projectId, action)` call at the top of every mutating service, because RLS alone cannot express rules like "an Admin may not modify an Owner" (`01 §BR-2`) cleanly, and because failing early gives a proper 403 rather than an empty result set.

Frontend permission checks exist **only to hide UI**. They are never the security boundary.

---

## 8. API Architecture

REST over HTTPS, `/api/v1/`. Full specification in `05_api_spec.md`.

Conventions: plural nouns, kebab-case paths, camelCase JSON, ISO-8601 UTC timestamps, UUIDv7 ids, cursor pagination, one consistent error envelope, `Idempotency-Key` on creates.

**Why REST and not GraphQL or tRPC:** the client is not query-shape-diverse enough to justify GraphQL's operational cost, and the read path largely bypasses the API entirely. tRPC was the close call — it gives end-to-end type safety with no schema duplication — but plain REST plus shared Zod schemas achieves most of that benefit while remaining callable from anything.

---

## 9. AI Architecture

**None.** Per `00 §5` and `01 §20`.

The **seam for future addition**, specified now so it is not retrofitted badly:

- AI would live behind dedicated endpoints (`POST /api/v1/ai/parse-task`) that **return proposals**, never perform writes.
- The client renders a proposal into the normal task form for user confirmation. The existing deterministic create path performs the write.
- Consequence: model failure degrades to "the user types it themselves". No AI failure can corrupt data, and the prompt-injection surface stays out of the mutation path entirely.

---

## 10. Third-Party Integrations

| Service | Purpose | Failure mode |
|---|---|---|
| Supabase | Postgres, Auth, Realtime | Hard dependency — outage is downtime |
| Vercel | Hosting, edge, cron | Hard dependency |
| Resend | Transactional email | Soft — in-app notifications unaffected; sends retry |
| Google OAuth | Social login | Soft — email/password remains |
| Sentry | Error tracking | Soft — no user impact |

---

## 11. File / Storage Architecture

Not in MVP (A7). When added: Supabase Storage with **presigned URLs** — the server issues a short-lived signed link and the browser uploads directly to the bucket, so a 50 MB file never passes through a serverless function's memory or bandwidth. Bucket policies mirror project membership. Content-type and size validated server-side before the URL is issued.

---

## 12. Caching

| Layer | What | TTL |
|---|---|---|
| CDN | Static assets, landing | Immutable, hashed filenames |
| TanStack Query | Board, tasks, members | `staleTime` 30s; realtime invalidates on change |
| Next.js Data Cache | Analytics aggregates | 5 min, tag-invalidated on task completion |
| DB materialised view | Daily analytics rollups | Refreshed by cron |

Board data is deliberately **not** aggressively cached — realtime is the freshness mechanism, and a stale board is worse than a slightly slower one.

---

## 13. Background Jobs

Scheduled via `pg_cron` for pure-SQL jobs and Vercel Cron for jobs needing application logic.

| Job | Schedule | Runner | Purpose |
|---|---|---|---|
| `board_snapshot` | Daily 00:05 UTC | pg_cron | Write per-column task counts. **Irreplaceable** — a missed run is a permanent CFD gap |
| `weekly_digest` | Mon 09:00 local | Vercel Cron | Aggregate + send |
| `due_soon_scan` | Hourly | pg_cron | Queue 24h reminders |
| `notification_flush` | Every 5 min | Vercel Cron | Batch and send queued emails |
| `purge_soft_deleted` | Daily 03:00 | pg_cron | Hard-delete past retention |
| `renormalize_positions` | Daily 03:30 | pg_cron | Rewrite columns whose fractional gaps have narrowed |

All jobs are **idempotent** and keyed on `(job_name, run_date)` so a duplicate trigger cannot double-send or double-insert. Cron platforms guarantee at-least-once, not exactly-once.

---

## 14. Notifications

Write to a `notifications` table (in-app, realtime-delivered). Email requiring dispatch is enqueued in `notification_queue` with a `send_after` timestamp; the flush job groups by recipient within a 5-minute window and sends one email per recipient (`01 §FR-11`). Bounces and complaints from Resend webhooks mark the address undeliverable.

---

## 15–17. Logging, Monitoring, Error Handling

**Logging** — structured JSON: `timestamp, level, request_id, user_id, project_id, route, duration_ms, status`. `request_id` propagates from an inbound header through every log line. **Never logged:** tokens, passwords, full request bodies, comment content, email addresses in plaintext beyond the auth provider.

**Monitoring** — Sentry for exceptions with release tagging and source maps; Vercel Analytics for Web Vitals; Supabase dashboard for DB metrics. Alerts on: error rate >1% over 5 min, p95 latency >1s, snapshot job failure (silent failure here degrades a feature invisibly, which is the worst kind), email bounce rate >5%.

**Error handling** — a single `AppError` hierarchy (`ValidationError`, `AuthError`, `ForbiddenError`, `NotFoundError`, `ConflictError`) mapped centrally to status codes. Unexpected exceptions return a generic 500 with a `request_id` the user can quote; internals are never leaked. React error boundaries at route and chart level so one broken chart does not blank the page. Client mutations retry idempotent operations twice with exponential backoff.

---

## 18. Security Architecture

Summarised; specified in `07_security_spec.md`. Layers: TLS everywhere · httpOnly cookie sessions · RLS deny-by-default · service-layer authorization · Zod validation at every boundary · parameterised queries only · DOMPurify on rendered markdown · rate limiting on auth and writes · CSP with no `unsafe-inline` · secrets in the platform vault, never in `NEXT_PUBLIC_*`.

---

## 19–22. Scalability, Performance, Availability, Disaster Recovery

**Scalability.** Vertical first — this workload is small and Postgres handles it comfortably. Horizontal path when needed: read replicas for analytics, table partitioning of `activity` and `board_snapshots` by month (they grow unboundedly while everything else is bounded by team size), and a dedicated queue if notification volume outgrows table-based queuing.

**Performance.** Composite indexes on every board query path (`04 §Indexes`); pre-aggregated analytics rather than on-the-fly scans; bundle budget enforced in CI.

**Availability.** Target 99.5% (A8/M6). Multi-region is not justified at this scale. The realtime layer degrades gracefully: on websocket loss the client falls back to 30s polling and shows the reconnect banner, then becomes read-only after 30s rather than accepting writes it may not be able to reconcile.

**Disaster recovery.** RPO 24h, RTO 4h at the free tier — daily automated Postgres backups, weekly restore drill into a scratch project, migrations version-controlled and forward-only. Point-in-time recovery requires a paid tier; flag under M6.

---

## 23–25. Deployment, Environments, CI/CD

**Environments:** `local` (Supabase CLI, Docker Postgres) → `preview` (per-PR Vercel deployment against a seeded staging DB) → `production`. Never point a preview deployment at the production database.

**CI/CD pipeline on every PR:** typecheck → lint → unit tests (Vitest) → **RLS policy tests** → build → bundle-size check → Playwright E2E against preview → migration dry-run. Merge to `main` deploys to production behind an automatic rollback on error-rate spike.

**Migrations:** SQL files in version control, applied via Supabase CLI, forward-only, reviewed like code. No schema changes through the dashboard — a hand-edited production schema that no migration file describes is unreproducible.

---

## 26–28. Technology Choices, Alternatives, Trade-offs

Each choice is justified in full — need, selection, alternatives, scalability, cost, risk — in `06_tech_stack.md`.

**The three decisions that actually shape this system:**

1. **Supabase over a self-built backend.** Buys auth, realtime and RLS for roughly zero effort. Costs vendor coupling, mitigated by keeping logic in the app layer.
2. **Hybrid data access over a uniform API.** Buys a large reduction in endpoint count and lower read latency. Costs a split mental model — developers must know which operations go which way. Mitigated by a single documented rule: *reads and realtime go direct; anything that writes an activity row goes through the API.*
3. **Fractional indexing over integer positions.** Buys single-row reorders and concurrency safety. Costs a precision-exhaustion failure mode, mitigated by the renormalisation job.

---

## 29. Request Lifecycles

**Move a task (the critical path):**

1. Client computes `newPosition = (prev.position + next.position) / 2`; if inserting at an edge, `first - 1` or `last + 1`.
2. Zustand snapshot taken; optimistic reorder applied; frame renders.
3. `PATCH /api/v1/tasks/:id/position` with `{ columnId, position, mutationId }`.
4. Handler: verify JWT → load membership → require role ≥ Member → Zod-validate → confirm target column belongs to the same project.
5. Transaction: `UPDATE tasks SET column_id, position, mutation_id, updated_at` → `INSERT INTO activity (action='moved', from_column, to_column)` → commit.
6. Postgres replication emits the change; Supabase Realtime broadcasts to the project channel.
7. Other clients apply it. The originating client sees its own `mutationId` and reconciles instead of re-applying.
8. Response returns the canonical row; client replaces its optimistic entry.
9. On failure: snapshot restored, revert animation, toast with retry.

**Weekly digest:**
Cron → for each active project, run aggregate queries over `activity` and `tasks` for the 7-day window → render a fixed template (no generation) → enqueue one email per opted-in member → flush job sends → failures retry with backoff, capped at 3 attempts.

**Analytics load:**
Server Component → parallel queries: throughput from `activity`, cycle time from paired activity events, CFD from `board_snapshots`, workload from `tasks` → results streamed to the client → Recharts renders. Each chart is independently error-bounded.

---

## 30. Clear Separation of Concerns

| Layer | Owns |
|---|---|
| **Client** | Rendering, drag interaction, optimistic state, position arithmetic, filter/search under A1, realtime subscription |
| **Server** | AuthN/AuthZ, validation, transactions, activity logging, notification fan-out, aggregation, scheduled jobs |
| **Database** | Persistence, referential integrity, RLS, constraints, cron |
| **External** | Email delivery, OAuth identity, error aggregation |
| **AI** | Nothing. Not present. |

---

## 31. Recommended Architecture — Final

**Next.js 15 (App Router, TypeScript) on Vercel, with Supabase Postgres 16 for data, auth and realtime; direct RLS-protected client reads; Route-Handler-mediated writes carrying activity logging and business rules; pg_cron and Vercel Cron for scheduled aggregation; Resend for email; Sentry for observability. No AI components.**

This is the smallest architecture that satisfies every P0 and P1 requirement while remaining honest about production concerns — and it can be built by one developer.

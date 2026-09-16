# Kanbo — Build Decisions & Phasing Addendum

**Date:** 2026-09-08
**Status:** Approved
**Relates to:** `docs/specs/00_project_analysis.md` – `docs/specs/07_security_spec.md` (the authoritative specs)

This document resolves the open decisions the PRD flagged as blocking development
(`01 §30`) and fixes the build sequence. It does not restate or supersede docs 00–07;
those remain the source of truth for requirements, schema, API and security.

## Amendments — 2026-09-14 (MVP roadmap)

| ID | Decision |
| --- | --- |
| A1 | Transactional business rules live in Postgres `security definer` RPCs; route handlers remain thin through `src/lib/api/handler.ts`. |
| M6 | Free tier only: nightly encrypted `supabase db dump` artifacts provide a 24-hour RPO; free projects are kept awake by scheduled pings; HIBP range checks replace built-in leaked-password protection. |
| S1 | Scheduled work uses `pg_cron`; email work calls protected `/api/cron/*` handlers through `pg_net` and `CRON_SECRET`. |
| S2 | Rate limiting uses Postgres fixed-window counters through service-role-only `consume_rate_limit`. |
| S3 | RLS acceptance is a Vitest integration suite against a hosted development/staging project, never a local Docker stack. |
| S4 | Weekly digests are per project at Monday 09:00 in `projects.timezone`. |
| S5 | Task watchers are creator, assignee, and commenters. |
| S6 | Commits use the user’s identity and contain no AI co-author or session trailers. |
| S7 | The complete resolved gap register is `docs/superpowers/plans/2026-09-11-kanbo-mvp/00-master-roadmap.md` §2. |

## Resolved open decisions

| ID | Question | Decision |
|----|----------|----------|
| M1 | Team-size ceiling for MVP | Assumptions A1–A3 stand: <500 tasks/project, <25 members, <10 concurrent viewers. No pagination/virtualisation in Phase 1. |
| M2 | Data residency / region (irreversible) | Supabase region **`ap-south-1` (Mumbai)**. |
| M3 | Viewer role in MVP | **Included.** RBAC table and RLS policies carry the Viewer role from the start. |
| M4 | Email sending domain / DNS | **Deferred.** All outbound email goes through an `EmailSender` interface with a console/no-op adapter in Phase 1. Resend adapter added when a sending domain with SPF/DKIM is available. Invitation *flows* are built and tested; only delivery is stubbed. |
| M5 | Soft-delete retention window | **30 days**, then hard purge by the `purge_soft_deleted` job. |
| M6 | Portfolio vs production bar | **Real users, small scale.** Free tier for compute; budget Supabase Pro for point-in-time recovery. DR restore drills are real, not notional. Observability (Sentry, structured logs, uptime + snapshot-failure alerts) is in scope. |

## Environment decisions

- **No Docker.** Local development runs against a **hosted Supabase dev project**, separate
  from staging and production. Migrations are applied to the remote via the Supabase CLI
  (`npx supabase`, no local stack). Three Supabase projects: `kanbo-dev`, `kanbo-staging`,
  `kanbo-prod`, all in `ap-south-1`.
- Hosting: Vercel. Preview deployments point at `kanbo-staging`, never production (`03 §24`).
- Package manager: npm (Node 24 LTS line).

## Build sequence

Phase 1 delivers all P0 requirements (`01 §13`) as three sequential plans, each producing
working, independently testable software:

1. **Plan 1A — Foundation & Auth.** Repo/scaffold/tooling/CI, Supabase `@supabase/ssr`
   wiring, email + Google auth, email-verification gate, route guards, deploy skeleton.
2. **Plan 1B — Data core.** Migrations for `users, projects, memberships, invitations,
   columns, tasks, subtasks, activity`; RLS + pgTAP acceptance gate; project / membership /
   invitation / transfer-ownership APIs on the handler→service→repository layering;
   append-only activity log.
3. **Plan 1C — The board.** Direct RLS-protected reads + Supabase Realtime with
   `mutation_id` echo suppression; task CRUD, soft delete, optimistic concurrency;
   dnd-kit drag & drop with keyboard equivalent; fractional indexing + renormalisation;
   activity feed screen; responsive board + a11y; production deploy.

Phase 2 (separate spec/plan cycle) adds: comments + mentions, labels, filters + search,
notifications, deterministic weekly summary, analytics dashboard, list view, dark mode,
and the remaining soft-delete surfaces — plus the `board_snapshots` job, which must ship
before the analytics dashboard (`00 §9`).

## Cross-cutting requirements (apply to every Phase 1 task)

- TypeScript strict; no `any` in application code (`01 §12`).
- TDD: failing test first, minimal implementation, frequent commits.
- Every API boundary validated with a shared Zod schema (`07 §5`).
- Every mutation: JWT verify → membership load → role check → Zod → transaction
  (mutation + `activity` insert) → post-commit notification enqueue (`03 §4`).
- SQL lives only in the repository layer (`03 §4`).
- Non-members get 404, never 403, on project-scoped resources (`05 §2`, `07 §4`).
- Secrets never in `NEXT_PUBLIC_*`; service-role key server-only (`07 §8`).

## Amendments — 2026-09-17 (Sub-plan 2B: members, roles & invitations)

| ID | Decision |
| --- | --- |
| B1 | New custom errcode `P0003` (`GONE`) extends the `P0001`/`P0002` convention: RPCs raise it for an expired, already-accepted, or already-declined invitation token so `mapRpcError` returns 410, distinct from 404 (`create_invitation`/`accept_invitation`/`decline_invitation`/`peek_invitation`, `202609170001_invitations_accept.sql`). |
| B2 | `idempotency_keys (user_id, key, request_hash, status, response jsonb, created_at)` covers invitation creation (`POST /invitations`) as of this sub-plan; task creation adopts it in 2C. No RLS policies — service-role only, deny by default. |
| B3 | Invite tokens are 32 CSPRNG bytes, base64url-encoded, handed to the invitee once; only the SHA-256 hex digest (`token_hash`) is ever persisted, so a database read can never recover a usable token. |
| B4 | `soft_delete_project` deletes `memberships` and `invitations` rows outright rather than soft-deleting them — neither table has a `deleted_at` column, and a deleted project's `uuid` is never reused, so there is nothing left to hide. |
| B5 | The invite-token cookie (`kanbo_invite`, httpOnly, 1h) is read and cleared by **both** `/auth/callback` (Google OAuth) and `/auth/confirm` (email-signup verification) — G11 only specified "the callback route," but email signup verifies through `/auth/confirm`, not `/auth/callback`, so both needed the same handoff for the invite flow to actually work end to end. |

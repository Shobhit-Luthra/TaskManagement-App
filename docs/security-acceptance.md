# Security acceptance — `07 §18`

Walk of the 12 release-blocking criteria in `docs/specs/07_security_spec.md §18`, recorded 2026-09-21 (Task 2G.6). **Full** = automated evidence proves the item as written. **Partial** = the guarantee holds but the evidence is narrower than, or differently shaped from, the spec text; the gap is stated so it can be closed or explicitly accepted before launch (Task 2G.7 gate).

CI context (`.github/workflows/ci.yml`): `secrets` (gitleaks) → `quality` (typecheck, lint, `test:coverage`, `npm audit --audit-level=high`, build, bundle size) → `rls` (`npm run test:rls` against staging) → `migrations` (dry-run push).

| # | Criterion (abridged) | Status | Evidence | Gap |
|---|---|---|---|---|
| 1 | User B receives zero rows from A's project, every table | Partial | `src/test/rls/isolation.test.ts` (non-member read/write denial across tasks, subtasks, users, activity, rate limits); per-feature files `members.test.ts`, `project-lifecycle.test.ts`, `comments.test.ts`, `labels.test.ts`, `notifications.test.ts`, `analytics.test.ts`. Runs in CI `rls`. | Spec names **pgTAP**; the suite is Vitest + `supabase-js` against a real project (same guarantee, different tooling). Coverage is per feature, not a generated per-table loop. |
| 2 | Every table has RLS and ≥1 explicit policy; CI fails otherwise | Partial | `202609110002_rls_audit.sql` `tables_without_rls()` flags any public table without RLS enabled **and forced**; asserted empty by `isolation.test.ts › public-table RLS audit`, in CI. | Audit checks enabled+forced, not policy count. A deny-all table with zero policies (intentional for `job_runs`, `rate_limits`) passes. |
| 3 | No `NEXT_PUBLIC_*` secret; secret scanning passes | Partial | CI `secrets` job runs `gitleaks/gitleaks-action@v2` (full history). `src/lib/env.ts` keeps client and server schemas separate; `SUPABASE_SERVICE_ROLE_KEY` is server-only. | No automated assertion that `NEXT_PUBLIC_*` values are non-secret beyond the schema split; no repo `.gitleaks.toml`. |
| 4 | Viewer gets 403 on every write endpoint | Partial | `can_write_project` (`202609090001_data_core.sql`) gates every write RPC and excludes `viewer`; viewer→`42501` asserted in `comments.test.ts`, `labels.test.ts`; `handler.test.ts` maps `42501`→403. | Not a per-endpoint matrix: tasks, columns, subtasks and project writes rely on the shared guard without a viewer-specific test each. |
| 5 | Admin cannot promote to Owner | Full | `members-lifecycle.test.ts › change_member_role › cannot promote anyone to Owner via this RPC`, `a Member cannot change anyone's role`; ownership moves only via `transfer_ownership` (Owner-only, `project-lifecycle.test.ts`). | — |
| 6 | Removed member's next request fails; realtime channel closes | Full | `members-lifecycle.test.ts › remove_member › … B's next read returns zero rows`; `src/lib/realtime/use-project-channel.ts` memberships-DELETE handler → `onMembershipRemoved` (unit test `use-project-channel.test.tsx`), consumers unsubscribe and redirect to `/projects?removed=1`; `202609180001_publication_memberships.sql`. | Channel closes client-side on the membership-delete event (RLS already denies the data server-side). |
| 7 | Stored XSS in comments and descriptions renders inert | Partial | `src/lib/comments/markdown.test.tsx › renders unsafe content inert` (`<script>`, `<iframe>`, `javascript:`, `<img onerror>`, `<svg onload>`, `data:`); no `dangerouslySetInnerHTML` in `src/`. | Task descriptions are rendered as React text (inert by construction) but have no dedicated payload test. |
| 8 | Invitation replay → 410; mismatched email → 403 | Full | `invitations.test.ts`: `second accept returns 410 GONE`, `rejects an email mismatch with 403, not enumeration`, `a revoked token can no longer be accepted`. | — |
| 9 | Rate limits on auth, invitations, writes | Partial | `src/lib/api/rate-limit.ts` (`writes` 100/min, `reads` 300/min, `invitations` 20/h, `analytics` 30/min; fails closed) + `rate-limit.test.ts`; `handler.test.ts › returns 429 when the limit is exhausted`; `202609110001_rate_limits.sql`. | **Auth** relies on Supabase Auth's built-in limits (surfaced via `mapAuthError` 429 copy); no app-level limiter on sign-in/sign-up. |
| 10 | HSTS, CSP, nosniff, Referrer-Policy, `frame-ancestors 'none'` | Full | Static headers `src/lib/security/headers.ts` + `headers.test.ts`; per-request CSP with a 16-byte CSPRNG nonce and no `'unsafe-inline'` in `script-src`: `src/lib/security/csp.ts`, `csp.test.ts`, set in `src/proxy.ts`. Verified on a production build with headless Chrome: nonce rotates per request, every rendered `<script>` carries it (incl. `next-themes` bootstrap), login/projects/board/analytics/account hydrate with zero CSP violations, Realtime websocket permitted by `connect-src`. | — |
| 11 | `npm audit` clean of high/critical | Full | CI `quality` job: `npm audit --audit-level=high`. | — |
| 12 | Non-member → 404, never 403, on project-scoped resources | Full | `members.test.ts › project-scoped 404 for non-members (07 §18.12)`; `invitations.test.ts › a non-member cannot invite (404)`; `comments.test.ts` (P0002); `handler.test.ts › mapRpcError › hides membership from non-members when projectScoped`. | — |

## Additional properties verified (beyond §18)

| Property | Evidence |
|---|---|
| Account deletion cannot orphan a sole-Owner project; profile anonymised; credentials revoked; audit trail survives | `src/test/rls/account-deletion.test.ts`; end-to-end run against `kanbo-dev` (old password rejected, old cookie → 401, email reusable) — Task 2G.5 |
| HIBP breach check never sends the full hash | `src/lib/auth/breach-check.test.ts` |
| Cron endpoints unreachable without `CRON_SECRET` | `src/app/api/cron/snapshot-heartbeat/route.test.ts`, `src/app/api/cron/[job]/route.ts` |
| Cross-origin API calls rejected | `withApiHandler` origin check (`src/lib/api/handler.ts`) + `handler.test.ts` |
| Signed-out requests to app routes redirect to `/login` | `src/proxy.ts` (`updateSession`) — verified live on dev and prod builds. Note: before 2G.6 this file lived at the repo root and was never registered by Next (a `src/` project must keep it in `src/`), so this protection had been page-level only. |

## Open before launch (Task 2G.7 gate)

Each Partial row above is a decision for the launch review: close the gap, or accept it in writing. Suggested cheapest closures, in order of value:

1. **§18.4** — one parameterised viewer-403 test hitting every write RPC (tasks, columns, subtasks, project, members).
2. **§18.2** — extend `tables_without_rls()` (or add a sibling) to also report tables with RLS enabled but zero policies, with an explicit allow-list for deny-all tables.
3. **§18.9** — decide whether Supabase Auth's built-in throttling satisfies "verified on auth" or add an app-level limiter on the auth server actions.
4. **§18.7** — add a task-description payload case to the XSS corpus.
5. **§18.1 / §18.3** — tooling wording: record that Vitest-against-Supabase replaces pgTAP and gitleaks replaces the unnamed secret scanner; add a `.gitleaks.toml` if custom rules are wanted.

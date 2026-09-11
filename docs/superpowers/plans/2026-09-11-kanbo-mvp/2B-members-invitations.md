# Kanbo Sub-plan 2B — Members, roles & invitations (P0)

> **Status: task-level.** Expand this file to step-level (bite-sized TDD steps with code) using `superpowers:writing-plans` immediately before execution, then run it with `superpowers:subagent-driven-development`. Do not start until Sub-plan 2A has shipped to staging with CI green.
>
> **Read first:** `00-master-roadmap.md` §2 (Gap Register — the G*/T* ids referenced below), §4 (cross-cutting rules, including the security-property requirement for auth/membership/token tasks), and the *Interfaces* blocks of the previous sub-plans — every task here consumes `withApiHandler` / `mapRpcError` (`src/lib/api/handler.ts`), `RATE_LIMITS` (`src/lib/api/rate-limit.ts`), `createAdminClient` (`src/lib/supabase/admin.ts`), `seedIsolationFixture` (`src/test/rls/setup.ts`) and `log` (`src/lib/log.ts`) from 2A.
>
> **Commit rule:** Conventional Commits, no AI co-author or session trailers.

**Spec:** `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md` + `docs/specs/00`–`07`; `00-master-roadmap.md` §5 Sub-plan 2B.

**Definition of done:** every task's acceptance tests green; new tables covered by the RLS isolation suite; `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build && npm run size` green; preview deployment on staging exercised manually; CI green on the PR.

---

## Tasks

**Task 2B.1 — Peer visibility (T5)**
- Files: migration `users_project_peers` policy + `project_peers` view; RLS test.
- Also in this task: make every existing RPC check `is_project_member` **before** `can_write_project` and raise `P0002` (`TASK_NOT_FOUND` / `PROJECT_NOT_FOUND`) for non-members, keeping `42501` only for members without write rights (viewers). Then switch the project-scoped route handlers to `mapRpcError(error, { …, projectScoped: true })` so non-members receive 404, never 403 (`05 §2`, `07 §18.12`). RLS suite asserts B gets 404 from `PATCH /api/v1/projects/P`.
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

---

## Verification (sub-plan exit)

See `00-master-roadmap.md` §6. Playwright flows relevant to this sub-plan are listed there; add the ones this sub-plan enables to `e2e/` when Playwright is introduced (first needed in 2B.4).

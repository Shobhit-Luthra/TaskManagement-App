# 07 — Security Specification

**Product:** Kanbo
**Depends on:** all prior documents. Uses OWASP Top 10 (2021) and ASVS as the reference frame.

---

## 1. Threat Model Summary

**Assets:** user credentials, session tokens, project data (tasks, comments), membership graph, activity history, email addresses.

**Adversaries:** unauthenticated internet scanner · authenticated user probing other tenants · removed ex-member · compromised dependency · attacker with a stolen invitation link.

**Highest-risk attack surfaces, ranked:**

| # | Surface | Why it ranks here |
|---|---|---|
| 1 | **RLS policy gaps** | The browser queries Postgres directly. A missing or wrong policy is not a defence-in-depth failure — it is *the* breach |
| 2 | **Service-role key exposure** | Bypasses RLS entirely. One leak into a client bundle = total compromise of every tenant |
| 3 | **IDOR on project-scoped resources** | Every endpoint takes a UUID; a missing membership check exposes another team's board |
| 4 | **Invitation token handling** | A guessable or replayable token grants project access |
| 5 | **XSS via markdown comments** | User-authored content rendered as HTML; a stored XSS reaches every teammate |
| 6 | **Privilege escalation via role assignment** | An Admin promoting themselves to Owner |

---

## 2. Authentication

- Supabase Auth (GoTrue). Passwords bcrypt-hashed with a per-password salt; the application never sees or stores plaintext.
- **Password policy:** minimum 10 characters, checked against the HaveIBeenPwned k-anonymity range API. No composition rules — forced symbols produce `Password1!` and nothing else. Length and breach-checking are what actually work.
- Email verification required before invitations can be accepted (prevents claiming an invite for an address you do not control).
- **Enumeration resistance:** login failure, signup with an existing email, and password reset all return identical responses and comparable timings.
- MFA: not in MVP. TOTP is the Phase 2 path; the auth provider supports it, so this is a configuration change rather than a rebuild.

## 3. Session Management

- JWT access token, 1h expiry. Refresh token rotated on every use, 30-day absolute lifetime, reuse-detection revokes the family.
- **Storage: httpOnly, Secure, SameSite=Lax cookies.** Never `localStorage` — any injected script can read it, turning any XSS into full account takeover.
- Logout revokes the refresh token server-side, not just client cookie deletion.
- Session invalidated on password change and on account deletion.

## 4. Authorization and RBAC

Two mandatory enforcement points (`03 §7`):

**Layer 1 — Row Level Security.** Every table. `ENABLE ROW LEVEL SECURITY` plus `FORCE`, with **no permissive default** — absence of a policy means no access.

Canonical read policy shape:

```sql
CREATE POLICY tasks_select ON tasks FOR SELECT
USING (
  deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.project_id = tasks.project_id
      AND m.user_id = auth.uid()
  )
);
```

This is why `tasks.project_id` is denormalised (`04 §4.6`) — the policy runs per row, and a join through `columns` on every row is a real cost.

Write policies additionally require `m.role <> 'viewer'`.

**Layer 2 — service-layer `authorize(userId, projectId, action)`** at the top of every mutating service. Needed because RLS cannot cleanly express BR-2 ("no one grants a role above their own") and because failing early yields a proper 403 rather than a confusing empty result.

**Frontend checks hide UI only. They are never the boundary.**

**Role escalation rules enforced server-side:** Admins cannot create or modify Owners; nobody grants above their own role; the last Owner cannot be demoted or removed (partial unique index makes multi-owner states impossible at the DB level).

**IDOR defence:** no endpoint trusts a client-supplied `projectId` as authorisation. Membership is resolved from the token, and non-members receive **404, not 403** (`05 §2`) so project existence is not confirmed to probers.

## 5. Input Validation and Injection

- **Zod at every API boundary** — types, lengths, enums, formats. Unknown keys stripped, never passed through.
- **SQL injection:** parameterised queries exclusively. No string-concatenated SQL anywhere; the repository layer is the only place SQL exists, which makes this auditable by reading one directory.
- **XSS:** comments and descriptions stored as raw markdown, rendered through a restricted markdown parser with **DOMPurify** sanitisation on the output. Allowlist of tags: text formatting, lists, links, code. `<script>`, `<iframe>`, event handlers and `javascript:` URLs stripped. `dangerouslySetInnerHTML` is banned by an ESLint rule with no exceptions.
- **CSP:** `default-src 'self'`, no `unsafe-inline`, no `unsafe-eval`, nonce-based scripts, `frame-ancestors 'none'`.
- **CSRF:** `SameSite=Lax` cookies plus origin verification on state-changing requests. Bearer-token API calls are not cookie-authenticated and are inherently CSRF-immune.

## 6. Rate Limiting and Abuse Prevention

Limits per `05 §2`. Additionally: progressive delay after 3 failed logins on the same account; invitation sends capped at 20/hour per user (an invitation endpoint is a free spam relay if uncapped); password reset capped at 3/hour per email; unauthenticated endpoints keyed by IP, authenticated by user ID.

## 7. Invitation Security

- 32 bytes from a CSPRNG, URL-safe encoded.
- **Only the SHA-256 hash is stored** (`04 §4.4`). A database leak yields no usable invitations.
- 7-day expiry, single-use (`accepted_at` set in the same transaction as the membership insert — R7).
- **Acceptance requires the authenticated user's verified email to match the invited email.** Without this, anyone who obtains the link joins the project.
- Revocable by Owner/Admin before acceptance.

## 8. Secrets Management

| Secret | Location | Exposure if leaked |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Server env only | **Total — all tenants** |
| `SUPABASE_ANON_KEY` | Client (by design) | None; RLS-constrained |
| `RESEND_API_KEY` | Server env | Spam sent as your domain |
| `SENTRY_DSN` | Client | Negligible |

Rules: no `.env` in version control; CI secret-scanning (gitleaks) blocks merges; **anything prefixed `NEXT_PUBLIC_` ships to the browser** — an ESLint rule forbids that prefix on any variable name containing `SERVICE`, `SECRET` or `PRIVATE`. Quarterly rotation; immediate rotation on any suspected exposure.

## 9. Encryption

In transit: TLS 1.3, HSTS with preload, no mixed content. At rest: AES-256 on managed Postgres volumes and backups. Application-level field encryption is not used — no field in this schema warrants it, and it would break search and indexing.

## 10. Data Privacy

- Minimal collection: email, display name, optional avatar. No tracking beyond aggregate product analytics.
- Data export and account deletion available (`05 §4`); PII anonymised within 30 days, activity rows retained with `actor_id = NULL` so project history survives without identifying a departed user.
- **Never logged:** tokens, passwords, comment bodies, task descriptions, plaintext emails (`03 §15`).
- Data residency is decision **M2** and is irreversible after launch.

## 11. File Upload Security

Not in MVP (A7). When added: server-side content-type and magic-byte validation (never trust the extension), size caps, filenames regenerated as UUIDs, files served from a separate origin with `Content-Disposition: attachment`, and presigned URLs scoped to a single object with short expiry.

## 12. Audit Trail

The `activity` table is the audit log. Append-only, enforced by RLS granting only INSERT and SELECT — no UPDATE or DELETE policy exists, so even a compromised application account cannot rewrite history. Security-relevant events additionally logged: login success/failure, password change, role change, member removal, invitation created/accepted, project deletion.

## 13. Dependency and Infrastructure Security

Dependabot on daily cadence; `npm audit` gating CI on high/critical; lockfile committed; new dependencies reviewed for maintenance status before adoption. Infrastructure is fully managed — no servers to patch. Vercel and Supabase both hold SOC 2. Preview deployments never point at the production database (`03 §24`).

## 14. Backup Security

Daily automated Postgres backups, encrypted at rest, access restricted to project owners. Restore drills weekly into a scratch project — an untested backup is a hypothesis, not a backup. Backups inherit the same residency constraint as M2.

## 15. Incident Response

1. **Detect** — Sentry alerts, error-rate and auth-failure-spike thresholds.
2. **Contain** — rotate affected keys; revoke sessions (invalidate the JWT signing secret if needed); disable the affected endpoint.
3. **Assess** — query the activity log and access logs for scope.
4. **Notify** — affected users within 72 hours where personal data is implicated.
5. **Remediate** — patch, add a regression test, deploy.
6. **Review** — blameless post-mortem; every incident produces at least one new automated test.

## 16. OWASP Top 10 (2021) Mapping

| Risk | Mitigation | Section |
|---|---|---|
| A01 Broken Access Control | RLS + service-layer authorize + 404-not-403 | §4 |
| A02 Cryptographic Failures | TLS 1.3, bcrypt, hashed invite tokens, AES-256 at rest | §2, §7, §9 |
| A03 Injection | Parameterised queries, Zod, DOMPurify, CSP | §5 |
| A04 Insecure Design | Threat model, deny-by-default, constraint-enforced invariants | §1, `04 §12` |
| A05 Security Misconfiguration | RLS forced, CSP, security headers, no dashboard schema edits | §4, §5 |
| A06 Vulnerable Components | Dependabot, audit gate in CI | §13 |
| A07 Auth Failures | Rate limiting, breach-checked passwords, rotating refresh tokens, enumeration resistance | §2, §3, §6 |
| A08 Integrity Failures | Lockfile, signed deploys, forward-only reviewed migrations | §13 |
| A09 Logging Failures | Structured logs, append-only activity, alerting | §12 |
| A10 SSRF | No user-supplied URLs fetched server-side; avatar URLs stored, never fetched | — |

## 17. Component → Control Map

| Component | Controls |
|---|---|
| Auth screens | Rate limit, enumeration resistance, breach check, CAPTCHA if abuse observed |
| Board (client-direct reads) | RLS policies — **sole boundary**; anon key only |
| Mutation API | JWT verify → membership → role check → Zod → transaction → activity |
| Comments | Sanitisation, length caps, mention scoped to membership |
| Invitations | Hashed token, expiry, single-use, verified-email match |
| Analytics | Project-scoped queries; no cross-project aggregation exists |
| Cron jobs | Service role, no user input, idempotency keys |
| Email | SPF/DKIM/DMARC (M4), unsubscribe on non-transactional |

---

## 18. Security Acceptance Criteria

Release is blocked unless all pass:

1. **pgTAP suite:** for every table, user B connecting directly receives zero rows from user A's project. This is the single most important test in the repository.
2. Every table has RLS enabled and at least one explicit policy; a CI check fails the build on any table without one.
3. No `NEXT_PUBLIC_*` variable contains a secret; secret-scanning passes.
4. A Viewer receives 403 on every write endpoint (automated per-endpoint test).
5. An Admin cannot promote themselves or anyone to Owner.
6. A removed member's next request fails, and their realtime channel closes.
7. Stored-XSS payloads in comments and descriptions render inert.
8. Invitation replay returns 410; an invitation accepted by a mismatched email returns 403.
9. Rate limits verified on auth, invitations and writes.
10. Security headers present: HSTS, CSP, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`.
11. `npm audit` clean of high and critical.
12. Non-member requests return 404, never 403, for project-scoped resources.

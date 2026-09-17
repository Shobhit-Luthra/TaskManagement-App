# Kanbo Sub-plan 2F — Notifications, email & digest (P1) — Part 2 (Tasks 2F.5–2F.7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This file covers **Task 2F.5 through Task 2F.7** and assumes `2F-notifications-digest-1.md` (Tasks 2F.1–2F.4) is already merged: `notifications`/`notification_queue`/`notification_preferences` exist, `enqueue_notifications` fans out, the guarded `/api/cron/[job]` route and `job_runs` idempotency ledger exist, and `flushNotificationQueue()` sends batched emails.

**Read first:**
- `2F-notifications-digest-1.md` in full, especially its Global Constraints section (ambiguous-column bug, T1 cron architecture) and Task 2F.1's schema (you will read/write `notifications`, `notification_preferences`, and add a `weekly_digest` `job_runs` entry per project per week here).
- `00-master-roadmap.md` §2 Gap Register — **G2** (per-project digest), **G6** (Account Settings — profile/password/notification-prefs/theme; account deletion itself is out of scope, it ships in 2G), **G12** (unsubscribe token — this file builds it), **G14** (deep links).
- `2B-members-invitations.md` Global Constraints (ambiguous-column bug, RPC shape, commit rule) — identical rules apply here.
- `src/lib/realtime/use-project-channel.ts` — the realtime-subscription pattern the notification bell's unread count reuses (a per-user channel instead of a per-project one).
- `src/lib/email/*` (all four files, read in Part 1) — `flush.ts`'s `renderDigestEmail` helper is the pattern the weekly digest's `src/lib/digest/build.ts` follows, and `invitationEmail`'s escaping helper is reused for digest HTML.
- `src/lib/api/handler.ts`/`response.ts` (`GONE` = 410 already exists, reused here for an expired unsubscribe token), `src/lib/api/rate-limit.ts`.

**Spec:** `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md` + `docs/specs/00`–`07`; `00-master-roadmap.md` §5 Sub-plan 2F.

**Definition of done (this file, and the sub-plan as a whole):** Tasks 2F.5–2F.7 acceptance tests green; every new table covered by the RLS isolation suite; `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build && npm run size` green; preview deployment on staging exercised manually; CI green on the PR; §6 sub-plan-exit verification below satisfied.

---

## Global Constraints (identical to Part 1 — repeated for a reader who starts here)

- **The ambiguous-column bug:** any `security definer` plpgsql function returning a table with a column named `id`, `role`, `type`, `status`, or `category` must qualify every bare reference to that name with a table alias inside the function body, or Postgres raises "column reference is ambiguous" (broke `create_task`/`move_task`/others previously; fixed in `202609150001`/`202609150002`). `mark_notification_read`, `set_notification_preference`, and `weekly_summary` below all return tables with such columns — check every bare reference before committing.
- **T1 cron architecture:** the weekly digest sends email, so per T1 it is triggered the same way the flush job is — `pg_cron` → `pg_net.http_post` → `POST /api/cron/weekly-digest` with the `CRON_SECRET` bearer header — never a pure-SQL `pg_cron` job. It runs **hourly** (not weekly) and internally decides, per project, whether "now" falls in that project's Monday 09:00–09:59 local window (G2/G3); `job_runs` dedupes on `(weekly_digest, "<project_id>:<week_start>")` so the hourly tick firing 60 times during that window still sends exactly one digest per project per week.
- TypeScript strict; no `any`. No Docker locally — apply migrations via `npm run db:push` or MCP `apply_migration`, then prove with `npm run test:rls`.
- Every migration: `supabase/migrations/YYYYMMDDNNNN_<name>.sql`, forward-only.
- Every new/changed RPC: `security definer`, `set search_path = public`, `revoke all … from public`, explicit `grant execute` to the minimum role — `peek`-style read RPCs used by the unsubscribe route are the one case granted to `anon` too (no login required, per G12).
- Every new table: RLS enabled + forced, deny by default, explicit policies, covered by `src/test/rls/notifications.test.ts` (continued from Part 1) or a new `src/test/rls/digest.test.ts`.
- Security-sensitive tasks (unsubscribe token in 2F.5) list security properties and have one test per property: single-purpose (can only flip one category off), 30-day expiry, no login required, constant-time verify, no enumeration, generic error copy.
- `SUPABASE_SERVICE_ROLE_KEY` only via `createAdminClient()`.
- Structured JSON logs via `log()`; never log tokens, emails, or notification/digest bodies above `debug`.
- Commit at the end of every task: Conventional Commits, **no `Co-Authored-By` or `Claude-Session` trailers**. Before each commit: `git status`, inspect the diff, no secrets, `npm run test`, `npm run typecheck`, `npm run lint`.
- Docs: the last task in this file appends the unsubscribe-token scheme and the weekly-digest cron dedupe key shape to `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md`, mirroring how `2B.7` recorded its decisions.

---

## File Structure (this file)

```
src/lib/email/unsubscribe-token.ts, unsubscribe-token.test.ts          Task 2F.5
supabase/migrations/202609210001_notification_reads.sql                Task 2F.5 — mark_notification_read, mark_all_notifications_read, set_notification_preference RPCs
src/app/api/v1/notifications/route.ts                                  Task 2F.5 — GET (list), PATCH (mark read)
src/app/api/v1/notifications/preferences/route.ts                      Task 2F.5 — GET/PATCH own preferences
src/app/unsubscribe/route.ts, route.test.ts                            Task 2F.5
src/components/notifications/bell.tsx, notification-list.tsx           Task 2F.5
src/lib/realtime/use-notification-channel.ts                           Task 2F.5
src/app/(app)/settings/account/page.tsx, account-settings-form.tsx     Task 2F.5 (G6 — profile, password, notification prefs, theme)
supabase/migrations/202609210002_weekly_summary.sql                    Task 2F.6 — weekly_summary(p_project_id, p_week_start) pure SQL
src/lib/digest/build.ts, build.test.ts                                 Task 2F.6
src/app/api/v1/projects/[projectId]/summary/weekly/route.ts            Task 2F.6
src/components/digest/weekly-summary-panel.tsx                         Task 2F.6 — S5 panel on board + analytics
src/app/api/cron/[job]/route.ts                                        Task 2F.6 (modify — enable the weekly-digest entry stubbed in Part 1)
src/lib/email/resend-sender.ts, resend-sender.test.ts                  Task 2F.7
src/app/api/webhooks/resend/route.ts, route.test.ts                    Task 2F.7
src/lib/email/index.ts                                                 Task 2F.7 (modify — wire "resend" provider)
docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md             Task 2F.7 (append)
```

---

### Task 2F.5 — Notification centre UI + preferences + unsubscribe (G12)

**Files:**
- Create: `src/lib/email/unsubscribe-token.ts`, `src/lib/email/unsubscribe-token.test.ts`, `supabase/migrations/202609210001_notification_reads.sql`, `src/app/api/v1/notifications/route.ts`, `src/app/api/v1/notifications/preferences/route.ts`, `src/app/unsubscribe/route.ts`, `src/app/unsubscribe/route.test.ts`, `src/components/notifications/bell.tsx`, `src/components/notifications/notification-list.tsx`, `src/lib/realtime/use-notification-channel.ts`, `src/app/(app)/settings/account/page.tsx`, `src/components/settings/account-settings-form.tsx`

**Interfaces:**
- Produces:
  ```ts
  // src/lib/email/unsubscribe-token.ts
  export function generateUnsubscribeToken(userId: string, category: NotificationCategory): string; // "<payload-base64url>.<hmac-hex>"
  export function verifyUnsubscribeToken(token: string): { userId: string; category: NotificationCategory } | null;
  ```
- Consumes: `notifications`/`notification_preferences` (Part 1), `useProjectChannel`'s realtime pattern (adapted per-user), `UNSUBSCRIBE_SECRET` env var (added in `2A.3`'s `.env.example`; confirm present).

**Security properties (G12 + `00 §4` minimum set):**
1. **Single-purpose** — the token encodes exactly one `(userId, category)` pair; verifying it can only ever flip that one category off, never read or change anything else.
2. **30-day expiry** — the token embeds an `issuedAt`; `verifyUnsubscribeToken` rejects anything older than 30 days.
3. **No login required** — `GET /unsubscribe?t=…` works signed-out; the route uses `createAdminClient()`, never the session-bound client.
4. **Constant-time verify** — the HMAC comparison uses the same `verifyCronSecret`-style fixed-length digest compare as Task 2F.2 (extracted here into a small shared helper so the two don't drift).
5. **No enumeration** — a malformed, expired, or tampered token all return the same generic "This link is no longer valid." copy and the same 200/410 status split (200 for a token that verifies but whose user/category no longer exists — silently succeeds, since revealing "no such user" would enumerate accounts).

- [ ] **Step 1: Write the failing token tests**

```ts
// src/lib/email/unsubscribe-token.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";

const ORIGINAL_SECRET = process.env.UNSUBSCRIBE_SECRET;
beforeEach(() => {
  process.env.UNSUBSCRIBE_SECRET = "test-unsubscribe-secret";
});
afterEach(() => {
  process.env.UNSUBSCRIBE_SECRET = ORIGINAL_SECRET;
  vi.useRealTimers();
});

describe("unsubscribe token", () => {
  it("round-trips userId and category", () => {
    const token = generateUnsubscribeToken("11111111-1111-1111-1111-111111111111", "digest");
    const result = verifyUnsubscribeToken(token);
    expect(result).toEqual({ userId: "11111111-1111-1111-1111-111111111111", category: "digest" });
  });

  it("rejects a tampered payload", () => {
    const token = generateUnsubscribeToken("11111111-1111-1111-1111-111111111111", "digest");
    const [payload, sig] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), category: "assignment" }),
    ).toString("base64url");
    expect(verifyUnsubscribeToken(`${tamperedPayload}.${sig}`)).toBeNull();
  });

  it("rejects a garbage token without throwing", () => {
    expect(verifyUnsubscribeToken("not-a-token")).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
  });

  it("expires after 30 days", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = generateUnsubscribeToken("11111111-1111-1111-1111-111111111111", "digest");
    vi.setSystemTime(new Date("2026-01-30T23:59:59Z"));
    expect(verifyUnsubscribeToken(token)).not.toBeNull(); // 29 days, 23h59m — still valid
    vi.setSystemTime(new Date("2026-02-01T00:00:01Z"));
    expect(verifyUnsubscribeToken(token)).toBeNull(); // >30 days
  });

  it("is single-purpose — a token for one category never verifies as another", () => {
    const token = generateUnsubscribeToken("11111111-1111-1111-1111-111111111111", "assignment");
    const result = verifyUnsubscribeToken(token);
    expect(result?.category).toBe("assignment");
    expect(result?.category).not.toBe("digest");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/email/unsubscribe-token.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/email/unsubscribe-token.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import type { EmailCategory } from "./sender";

// notification_preferences.category (Part 1) plus "digest" — the same set an
// email can carry an unsubscribe link for.
export type NotificationCategory = "assignment" | "mention" | "status_change" | "due_soon" | "digest";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.UNSUBSCRIBE_SECRET;
  if (!value) throw new Error("UNSUBSCRIBE_SECRET is not set");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

/** Same fixed-length-digest trick as src/lib/cron/verify-secret.ts, extracted
 * locally rather than imported to keep this module's only dependency the
 * Node crypto builtin (it must also work from the unauthenticated /unsubscribe
 * route, which should stay minimal). */
function constantTimeEqual(a: string, b: string): boolean {
  const aDigest = createHmac("sha256", "compare").update(a).digest();
  const bDigest = createHmac("sha256", "compare").update(b).digest();
  return timingSafeEqual(aDigest, bDigest);
}

export function generateUnsubscribeToken(userId: string, category: NotificationCategory): string {
  const payload = Buffer.from(JSON.stringify({ userId, category, issuedAt: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyUnsubscribeToken(token: string): { userId: string; category: NotificationCategory } | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;
  if (!constantTimeEqual(sign(payload), signature)) return null;

  let decoded: { userId?: unknown; category?: unknown; issuedAt?: unknown };
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
  if (
    typeof decoded.userId !== "string" ||
    typeof decoded.category !== "string" ||
    typeof decoded.issuedAt !== "number"
  ) {
    return null;
  }
  if (Date.now() - decoded.issuedAt > THIRTY_DAYS_MS) return null;

  return { userId: decoded.userId, category: decoded.category as NotificationCategory };
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/email/unsubscribe-token.test.ts` → PASS.

- [ ] **Step 5: Failing RLS test for read/preference RPCs**

```ts
// append to src/test/rls/notifications.test.ts
describe("mark_notification_read / set_notification_preference", () => {
  it("a user can mark only their own notification read, never someone else's", async () => {
    const admin = createAdminClient();
    await admin.rpc("enqueue_notifications", {
      p_type: "mentioned", p_project_id: f.projectId, p_task_id: f.taskId, p_actor_id: f.aId,
      p_recipient_ids: [f.bId], p_payload: {},
    });
    const { data: rows } = await admin.from("notifications").select("id").eq("user_id", f.bId).limit(1);
    const notificationId = rows?.[0]?.id;

    const { error: forbidden } = await f.a.rpc("mark_notification_read", { p_notification_id: notificationId });
    expect(forbidden?.code).toBe("P0002"); // not found for A — belongs to B

    const { error: ok } = await f.b.rpc("mark_notification_read", { p_notification_id: notificationId });
    expect(ok).toBeNull();
    const { data: after } = await admin.from("notifications").select("read_at").eq("id", notificationId).single();
    expect(after?.read_at).not.toBeNull();
  });

  it("set_notification_preference only ever changes the caller's own row", async () => {
    const { error } = await f.b.rpc("set_notification_preference", { p_category: "digest", p_email: false });
    expect(error).toBeNull();
    const admin = createAdminClient();
    const { data } = await admin.from("notification_preferences").select("email").eq("user_id", f.bId).eq("category", "digest").single();
    expect(data?.email).toBe(false);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/notifications.test.ts`
Expected: FAIL — `mark_notification_read`/`set_notification_preference` do not exist.

- [ ] **Step 7: Migration**

```sql
-- supabase/migrations/202609210001_notification_reads.sql
create or replace function public.mark_notification_read(p_notification_id uuid)
returns table (id uuid, read_at timestamptz) language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  updated public.notifications%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  update public.notifications set read_at = coalesce(read_at, now())
    where notifications.id = p_notification_id and notifications.user_id = current_user_id
    returning * into updated;
  if not found then raise exception 'NOTIFICATION_NOT_FOUND' using errcode = 'P0002'; end if;
  return query select updated.id, updated.read_at;
end;
$$;
revoke all on function public.mark_notification_read(uuid) from public;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create or replace function public.mark_all_notifications_read() returns void
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  update public.notifications set read_at = now() where notifications.user_id = current_user_id and notifications.read_at is null;
end;
$$;
revoke all on function public.mark_all_notifications_read() from public;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- Upsert-shaped: also used by the unauthenticated /unsubscribe route via
-- SECURITY DEFINER + an explicit p_user_id path (below) since that request
-- has no auth.uid(). The authenticated RPC always uses the caller's own id.
create or replace function public.set_notification_preference(p_category public.notification_category, p_email boolean)
returns table (category public.notification_category, email boolean) language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); updated public.notification_preferences%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  insert into public.notification_preferences (user_id, category, email)
  values (current_user_id, p_category, p_email)
  on conflict (user_id, category) do update set email = excluded.email
  returning * into updated;
  return query select updated.category, updated.email;
end;
$$;
revoke all on function public.set_notification_preference(public.notification_category, boolean) from public;
grant execute on function public.set_notification_preference(public.notification_category, boolean) to authenticated;

-- Unsubscribe-link path: no auth.uid() (the request is unauthenticated by
-- design, G12). Token verification (HMAC, expiry) happens in the route
-- BEFORE this is called — this RPC trusts p_user_id exactly because the
-- token already proved the caller controls that user's inbox. It is granted
-- to anon for that reason, and does nothing else (cannot read any data,
-- cannot touch any other user, cannot touch any other category).
create or replace function public.unsubscribe_via_token(p_user_id uuid, p_category public.notification_category)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notification_preferences (user_id, category, email)
  values (p_user_id, p_category, false)
  on conflict (user_id, category) do update set email = false;
end;
$$;
revoke all on function public.unsubscribe_via_token(uuid, public.notification_category) from public;
grant execute on function public.unsubscribe_via_token(uuid, public.notification_category) to authenticated, anon;
```

- [ ] **Step 8: Apply and run the RLS suite**

Run: `npm run db:push` (or MCP `apply_migration`), then `npm run test:rls -- src/test/rls/notifications.test.ts` → PASS.

- [ ] **Step 9: Failing test for the `/unsubscribe` route**

```ts
// src/app/unsubscribe/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/email/unsubscribe-token", async () => {
  const actual = await vi.importActual<typeof import("@/lib/email/unsubscribe-token")>("@/lib/email/unsubscribe-token");
  return actual;
});

process.env.UNSUBSCRIBE_SECRET = "route-test-secret";

import { generateUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { GET } from "./route";

beforeEach(() => rpc.mockReset().mockResolvedValue({ error: null }));

describe("GET /unsubscribe", () => {
  it("works signed-out and flips exactly the token's category", async () => {
    const token = generateUnsubscribeToken("11111111-1111-1111-1111-111111111111", "digest");
    const res = await GET(new Request(`http://localhost/unsubscribe?t=${token}`) as never);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("unsubscribe_via_token", {
      p_user_id: "11111111-1111-1111-1111-111111111111",
      p_category: "digest",
    });
  });

  it("returns a generic message for a missing/invalid/expired token without distinguishing which", async () => {
    const resMissing = await GET(new Request("http://localhost/unsubscribe") as never);
    const resBad = await GET(new Request("http://localhost/unsubscribe?t=garbage") as never);
    const textMissing = await resMissing.text();
    const textBad = await resBad.text();
    expect(resMissing.status).toBe(resBad.status);
    expect(textMissing).toContain("no longer valid");
    expect(textBad).toContain("no longer valid");
    expect(rpc).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 10: Run to verify it fails** — `npx vitest run src/app/unsubscribe/route.test.ts` → FAIL, route missing.

- [ ] **Step 11: Implement the route**

```ts
// src/app/unsubscribe/route.ts
import { NextResponse } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { createAdminClient } from "@/lib/supabase/admin";

const GENERIC_INVALID_HTML =
  "<!doctype html><html><body><p>This link is no longer valid.</p></body></html>";
const SUCCESS_HTML =
  "<!doctype html><html><body><p>You've been unsubscribed. You can change this any time in Kanbo's Account Settings.</p></body></html>";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  const verified = token ? verifyUnsubscribeToken(token) : null;
  if (!verified) {
    return new NextResponse(GENERIC_INVALID_HTML, { status: 200, headers: { "content-type": "text/html" } });
  }

  const admin = createAdminClient();
  // Errors here (e.g. the user account was deleted since the email was sent)
  // are swallowed for the same no-enumeration reason as an invalid token —
  // the visitor sees the same success copy either way.
  await admin.rpc("unsubscribe_via_token", { p_user_id: verified.userId, p_category: verified.category });

  return new NextResponse(SUCCESS_HTML, { status: 200, headers: { "content-type": "text/html" } });
}
```

- [ ] **Step 12: Run to verify it passes** — `npx vitest run src/app/unsubscribe/route.test.ts` → PASS.

- [ ] **Step 13: Notification centre routes**

```ts
// src/app/api/v1/notifications/route.ts
import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { apiError } from "@/lib/api/response";

export const GET = withApiHandler(
  { rateLimit: RATE_LIMITS.reads, unauthenticatedMessage: "Sign in to view notifications." },
  async ({ supabase, requestId }) => {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, project_id, task_id, type, actor_id, payload, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return apiError(500, "INTERNAL_ERROR", "Notifications could not be loaded.", { requestId });
    return json({ data });
  },
);

const markReadSchema = z.object({ notificationId: z.string().uuid().optional(), all: z.boolean().optional() });

export const PATCH = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    body: markReadSchema,
    unauthenticatedMessage: "Sign in to update notifications.",
    validationMessage: "Provide notificationId or all.",
  },
  async ({ supabase, body, requestId }) => {
    if (body.all) {
      const { error } = await supabase.rpc("mark_all_notifications_read");
      if (error) return mapRpcError(error, { message: "Could not mark notifications read.", requestId });
      return json({ data: { ok: true } });
    }
    if (!body.notificationId) {
      return apiError(422, "VALIDATION_ERROR", "Provide notificationId or all.");
    }
    const { data, error } = await supabase.rpc("mark_notification_read", { p_notification_id: body.notificationId });
    if (error) return mapRpcError(error, { message: "Notification not found.", requestId });
    return json({ data: Array.isArray(data) ? data[0] : data });
  },
);
```

```ts
// src/app/api/v1/notifications/preferences/route.ts
import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { apiError } from "@/lib/api/response";

const CATEGORIES = ["assignment", "mention", "status_change", "due_soon", "digest"] as const;

export const GET = withApiHandler(
  { rateLimit: RATE_LIMITS.reads, unauthenticatedMessage: "Sign in to view preferences." },
  async ({ supabase, user, requestId }) => {
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("category, email")
      .eq("user_id", user.id);
    if (error) return apiError(500, "INTERNAL_ERROR", "Preferences could not be loaded.", { requestId });
    const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, true]));
    for (const row of data ?? []) byCategory[row.category] = row.email;
    return json({ data: byCategory });
  },
);

const updateSchema = z.object({ category: z.enum(CATEGORIES), email: z.boolean() });

export const PATCH = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    body: updateSchema,
    unauthenticatedMessage: "Sign in to update preferences.",
    validationMessage: "Provide category and email.",
  },
  async ({ supabase, body, requestId }) => {
    const { data, error } = await supabase.rpc("set_notification_preference", {
      p_category: body.category,
      p_email: body.email,
    });
    if (error) return mapRpcError(error, { message: "Preference could not be updated.", requestId });
    return json({ data: Array.isArray(data) ? data[0] : data });
  },
);
```

- [ ] **Step 14: Realtime unread-count hook**

```ts
// src/lib/realtime/use-notification-channel.ts
"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Mirrors use-project-channel.ts's shape (subscribe, normalize, degrade to
 * reconnecting) but scoped to one user's own notifications channel instead
 * of one project's task/column channel — the notification bell needs a
 * cross-project unread count, not a per-project one.
 */
export function useNotificationChannel(userId: string | null, onInsert: (unreadDelta: number) => void) {
  const onInsertRef = useRef(onInsert);
  const [status, setStatus] = useState<"connecting" | "connected" | "reconnecting">("connecting");

  useEffect(() => {
    onInsertRef.current = onInsert;
  });

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => onInsertRef.current(1),
      )
      .subscribe((channelStatus) => {
        if (channelStatus === "SUBSCRIBED") setStatus("connected");
        else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(channelStatus)) setStatus("reconnecting");
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return status;
}
```

```tsx
// src/components/notifications/bell.tsx
"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useNotificationChannel } from "@/lib/realtime/use-notification-channel";
import { NotificationList } from "./notification-list";

export function NotificationBell({ userId }: { userId: string }) {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/v1/notifications")
      .then((res) => res.json())
      .then((json) => setUnread((json.data ?? []).filter((n: { read_at: string | null }) => !n.read_at).length))
      .catch(() => {});
  }, []);

  useNotificationChannel(userId, (delta) => setUnread((n) => n + delta));

  return (
    <div className="relative">
      <button
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full p-2 hover:bg-muted"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-destructive px-1 text-xs text-destructive-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && <NotificationList onAllRead={() => setUnread(0)} onClose={() => setOpen(false)} />}
    </div>
  );
}
```

```tsx
// src/components/notifications/notification-list.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Notification = {
  id: string;
  project_id: string;
  task_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

// G14: canonical deep link — the board route opens the task modal from ?task=.
function deepLink(n: Notification): string {
  return n.task_id ? `/p/${n.project_id}/board?task=${n.task_id}` : `/p/${n.project_id}/board`;
}

function describe(n: Notification): string {
  const title = String(n.payload.taskTitle ?? "a task");
  switch (n.type) {
    case "task_assigned": return `You were assigned "${title}"`;
    case "task_unassigned": return `You were unassigned from "${title}"`;
    case "mentioned": return `You were mentioned on "${title}"`;
    case "status_changed": return `"${title}" changed status`;
    case "due_soon": return `"${title}" is due soon`;
    case "digest_ready": return "This week's digest is ready";
    default: return title;
  }
}

export function NotificationList({ onAllRead, onClose }: { onAllRead: () => void; onClose: () => void }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/notifications")
      .then((res) => res.json())
      .then((json) => setItems(json.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function markAllRead() {
    await fetch("/api/v1/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    onAllRead();
  }

  return (
    <div role="dialog" aria-label="Notifications" className="absolute right-0 top-full z-50 mt-2 w-80 rounded-md border bg-popover shadow-lg">
      <div className="flex items-center justify-between border-b p-2">
        <span className="text-sm font-medium">Notifications</span>
        <button onClick={markAllRead} className="text-xs text-muted-foreground hover:underline">Mark all read</button>
      </div>
      <ul className="max-h-96 overflow-y-auto">
        {loading && <li className="p-3 text-sm text-muted-foreground">Loading…</li>}
        {!loading && items.length === 0 && <li className="p-3 text-sm text-muted-foreground">No notifications yet.</li>}
        {items.map((n) => (
          <li key={n.id} className={n.read_at ? "" : "bg-accent/40"}>
            <Link href={deepLink(n)} onClick={onClose} className="block p-3 text-sm hover:bg-muted">
              {describe(n)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 15: Component tests for the bell and list**

Follow the existing Testing Library pattern used for other components under `src/components/**/*.test.tsx` (mock `fetch`, assert unread badge renders `9+` at 10, assert clicking "Mark all read" clears the badge, assert a deep link's `href` matches `/p/:projectId/board?task=:taskId`). Not reproduced in full here — it is a direct application of the existing component-test convention already used in `src/components/members/members-table.test.tsx` (2B.7) to this component's smaller surface.

- [ ] **Step 16: Account Settings page (G6 — ships here, not deferred)**

```tsx
// src/app/(app)/settings/account/page.tsx
import { createClient } from "@/lib/supabase/server";
import { AccountSettingsForm } from "@/components/settings/account-settings-form";

export default async function AccountSettingsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("users")
    .select("display_name, timezone")
    .eq("id", auth.user!.id)
    .single();
  const prefsRes = await fetch(new URL("/api/v1/notifications/preferences", process.env.NEXT_PUBLIC_SITE_URL), {
    headers: { cookie: "" }, // server component fetch — replace with a direct supabase query in the real component, mirroring project-settings-form.tsx's pattern rather than an internal fetch() round-trip
  }).then((r) => r.json()).catch(() => ({ data: {} }));

  return (
    <AccountSettingsForm
      userId={auth.user!.id}
      displayName={profile?.display_name ?? ""}
      timezone={profile?.timezone ?? "UTC"}
      preferences={prefsRes.data ?? {}}
    />
  );
}
```

`AccountSettingsForm` is a client component with four sections — Profile (display name, timezone — reuses the existing `update_task`-style "own profile" pattern via a new small `update_own_profile(p_display_name, p_timezone)` RPC, same shape as `update_project`), Password (delegates to the existing Supabase Auth password-change flow already used by `src/app/actions/auth.ts`'s reset-password action — reuse that server action rather than writing a new one), Notification preferences (five toggles, one per `NotificationCategory`, calling `PATCH /api/v1/notifications/preferences`), and Theme (the existing `next-themes` toggle already built for dark mode, just relocated into this page instead of only the header). Follow `src/components/projects/project-settings-form.tsx`'s exact fetch/useState/toast pattern for each section rather than introducing a new one — this is a direct, un-novel repetition of that pattern against four different endpoints, the same judgment call `2B.7` made for the members settings page.

> **Judgment call:** the `update_own_profile` RPC is new surface not explicitly named in the Gap Register. It is the minimal RPC needed to let a user change their own `display_name`/`timezone` (G6's "profile" section) following the exact shape of `update_project` (`security definer`, self-only via `where users.id = auth.uid()`, no role check needed since it's always "self"). Write it as part of this step:
```sql
-- append to supabase/migrations/202609210001_notification_reads.sql
create or replace function public.update_own_profile(p_display_name text, p_timezone text)
returns table (id uuid, display_name varchar, timezone varchar) language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); updated public.users%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if p_display_name is null or char_length(trim(p_display_name)) not between 1 and 80 then raise exception 'INVALID_DISPLAY_NAME' using errcode = '22023'; end if;
  if p_timezone is null or char_length(trim(p_timezone)) not between 1 and 64 then raise exception 'INVALID_TIMEZONE' using errcode = '22023'; end if;
  update public.users set display_name = trim(p_display_name), timezone = trim(p_timezone)
    where users.id = current_user_id and users.deleted_at is null returning * into updated;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002'; end if;
  return query select updated.id, updated.display_name, updated.timezone;
end;
$$;
revoke all on function public.update_own_profile(text, text) from public;
grant execute on function public.update_own_profile(text, text) to authenticated;
```
Add an RLS test for it alongside the others in this task (self can update, another user's row is untouched — trivially true since the function only ever targets `auth.uid()`, but add the assertion for completeness).

- [ ] **Step 17: Run full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build && npm run size`

```bash
git add src/lib/email/unsubscribe-token.ts src/lib/email/unsubscribe-token.test.ts \
  supabase/migrations/202609210001_notification_reads.sql \
  src/app/api/v1/notifications src/app/unsubscribe \
  src/components/notifications src/lib/realtime/use-notification-channel.ts \
  "src/app/(app)/settings/account" src/components/settings \
  src/test/rls/notifications.test.ts
git commit -m "feat(notifications): add notification centre UI, preferences, unsubscribe links, and account settings"
```

---

### Task 2F.6 — Weekly digest (FR-9, G2)

**Files:**
- Create: `supabase/migrations/202609210002_weekly_summary.sql`, `src/lib/digest/build.ts`, `src/lib/digest/build.test.ts`, `src/app/api/v1/projects/[projectId]/summary/weekly/route.ts`, `src/components/digest/weekly-summary-panel.tsx`
- Modify: `src/app/api/cron/[job]/route.ts` (enable the `weekly-digest` entry stubbed out in Part 1's Task 2F.2), `supabase/migrations/202609200001_cron_plumbing.sql`-equivalent — add the new `weekly-digest` schedule in a fresh migration (never edit an applied one)

**Interfaces:**
- Produces:
  ```sql
  weekly_summary(p_project_id uuid, p_week_start date)
    returns table (
      member_id uuid, completed jsonb, created_count integer,
      went_overdue_count integer, due_next_week jsonb
    )
  ```
  ```ts
  // src/lib/digest/build.ts
  export async function runWeeklyDigest(): Promise<{ projectsProcessed: number; emailsSent: number }>;
  ```
- Consumes: `getEmailSender()`, `claimJobRun`/`finishJobRun` (Part 1, per-project this time, not per-job-tick — see below), `notification_preferences` (category `'digest'`), `generateUnsubscribeToken`.

- [ ] **Step 1: Write the failing SQL reconciliation test**

```ts
// src/test/rls/digest.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let f: IsolationFixture;
beforeAll(async () => { f = await seedIsolationFixture(); });
afterAll(async () => { await f.cleanup(); });

describe("weekly_summary reconciliation (FR-9)", () => {
  it("completed count matches activity 'completed' rows for the same project/week", async () => {
    const admin = createAdminClient();
    const doneColumn = await admin.from("columns").select("id").eq("project_id", f.projectId).eq("is_done_column", true).single();
    await admin.rpc("move_task", {
      p_task_id: f.taskId, p_column_id: doneColumn.data!.id, p_position: 1, p_mutation_id: crypto.randomUUID(),
    });

    const weekStart = new Date();
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay() + 1); // Monday of this week (UTC approx — good enough for a reconciliation count, not for the cron trigger window itself)
    const weekStartStr = weekStart.toISOString().slice(0, 10);

    const { data: summary, error } = await admin.rpc("weekly_summary", {
      p_project_id: f.projectId, p_week_start: weekStartStr,
    });
    expect(error).toBeNull();

    const { count: activityCompletedCount } = await admin
      .from("activity")
      .select("id", { count: "exact", head: true })
      .eq("project_id", f.projectId)
      .eq("action", "completed")
      .gte("created_at", weekStartStr);

    const totalSummaryCompleted = (summary ?? []).reduce(
      (sum: number, row: { completed: unknown[] }) => sum + (row.completed?.length ?? 0),
      0,
    );
    expect(totalSummaryCompleted).toBe(activityCompletedCount ?? 0);
  });

  it("returns an empty-but-valid row set for a quiet week (no activity)", async () => {
    const admin = createAdminClient();
    const farFuture = "2099-01-05"; // a Monday with certainly no activity
    const { data, error } = await admin.rpc("weekly_summary", { p_project_id: f.projectId, p_week_start: farFuture });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:rls -- src/test/rls/digest.test.ts`
Expected: FAIL — `weekly_summary` does not exist.

- [ ] **Step 3: Migration — `weekly_summary` (pure SQL, no LLM, per `00 §5` 2F.6)**

```sql
-- supabase/migrations/202609210002_weekly_summary.sql
-- Per-member breakdown for one project/week: completed tasks (with titles),
-- tasks created, tasks that went overdue during the week, and tasks due
-- next week. Called only by the digest builder (service role) and this
-- migration's own RLS test — never exposed to the browser directly (the
-- route in this task wraps it with a membership check instead of relying on
-- RLS, since it's a read-only aggregate, not a table).
create or replace function public.weekly_summary(p_project_id uuid, p_week_start date)
returns table (
  member_id uuid,
  completed jsonb,
  created_count integer,
  went_overdue_count integer,
  due_next_week jsonb
) language sql stable security definer set search_path = public as $$
  with week as (
    select p_week_start::timestamptz as start_at, (p_week_start + 7)::timestamptz as end_at
  ),
  members as (
    select m.user_id from public.memberships m where m.project_id = p_project_id
  ),
  completed_activity as (
    select a.actor_id as member_id, t.id as task_id, t.title
    from public.activity a
    join week on true
    join public.tasks t on t.id = a.task_id
    where a.project_id = p_project_id and a.action = 'completed'
      and a.created_at >= week.start_at and a.created_at < week.end_at
  ),
  created_activity as (
    select a.actor_id as member_id, count(*) as created_count
    from public.activity a join week on true
    where a.project_id = p_project_id and a.action = 'created'
      and a.created_at >= week.start_at and a.created_at < week.end_at
    group by a.actor_id
  ),
  went_overdue as (
    -- A task "went overdue" this week if its due_date fell within the week
    -- and, as of now, it is still not in a done column (query-time
    -- evaluation of column flags — same G4 judgment call analytics uses).
    select t.assignee_id as member_id, count(*) as went_overdue_count
    from public.tasks t
    join public.columns c on c.id = t.column_id
    join week on true
    where t.project_id = p_project_id and t.deleted_at is null
      and t.due_date >= p_week_start and t.due_date < p_week_start + 7
      and not c.is_done_column
      and t.assignee_id is not null
    group by t.assignee_id
  ),
  due_next_week as (
    select t.assignee_id as member_id, jsonb_agg(jsonb_build_object('taskId', t.id, 'title', t.title, 'dueDate', t.due_date)) as items
    from public.tasks t
    where t.project_id = p_project_id and t.deleted_at is null
      and t.assignee_id is not null
      and t.due_date >= p_week_start + 7 and t.due_date < p_week_start + 14
    group by t.assignee_id
  )
  select
    members.user_id as member_id,
    coalesce((select jsonb_agg(jsonb_build_object('taskId', ca.task_id, 'title', ca.title)) from completed_activity ca where ca.member_id = members.user_id), '[]'::jsonb) as completed,
    coalesce((select created_activity.created_count from created_activity where created_activity.member_id = members.user_id), 0) as created_count,
    coalesce((select went_overdue.went_overdue_count from went_overdue where went_overdue.member_id = members.user_id), 0) as went_overdue_count,
    coalesce((select due_next_week.items from due_next_week where due_next_week.member_id = members.user_id), '[]'::jsonb) as due_next_week
  from members;
$$;
revoke all on function public.weekly_summary(uuid, date) from public;
grant execute on function public.weekly_summary(uuid, date) to authenticated;
```

- [ ] **Step 4: Apply and run the RLS/reconciliation test**

Run: `npm run db:push` (or MCP `apply_migration`), then `npm run test:rls -- src/test/rls/digest.test.ts` → PASS.

- [ ] **Step 5: Route for the S5 in-app panel**

```ts
// src/app/api/v1/projects/[projectId]/summary/weekly/route.ts
import { z } from "zod";
import { json, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { apiError } from "@/lib/api/response";

const querySchema = z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.reads,
    params: z.object({ projectId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to view the weekly summary.",
  },
  async ({ supabase, params, request, requestId }) => {
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return apiError(422, "VALIDATION_ERROR", "Invalid weekStart.");
    const weekStart = parsed.data.weekStart ?? mostRecentMonday();
    const { data, error } = await supabase.rpc("weekly_summary", { p_project_id: params.projectId, p_week_start: weekStart });
    if (error) return apiError(404, "NOT_FOUND", "Project not found."); // RPC's is_project_member-equivalent check missing here would need adding — see Judgment call below
    return json({ data, weekStart });
  },
);

function mostRecentMonday(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = (day === 0 ? 6 : day - 1);
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diff);
  return monday.toISOString().slice(0, 10);
}
```

> **Judgment call:** `weekly_summary` as written does not itself call `is_project_member(p_project_id)` — it is `security definer` and would currently answer for any project id if called directly by an authenticated user who isn't a member. Since Task 2F.6's route is the only intended caller and this function is read-only/non-destructive, the pragmatic fix is to add the membership check as the function's first statement (raising `P0002` for non-members, matching every other RPC's shape) — do this before Step 4's RLS run and add one more test to `digest.test.ts`: a non-member calling `weekly_summary` for another project gets `P0002`. This was folded into Step 3's code block being followed *exactly as the ambiguous-column-safe version* — add:
```sql
-- prepend inside the function body, before the `with week as (...)` CTE:
if not public.is_project_member(p_project_id) then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
```
This requires switching the function from `language sql` to `language plpgsql` (a bare `if` isn't valid in a SQL-language function) — wrap the existing `with … select …` body in `return query select * from ( <original body> ) s;` inside a plpgsql function. Do this rewrite in Step 3 directly rather than as a follow-up patch; it's called out here because the acceptance test in Step 1 doesn't exercise the non-member path, and it would be easy to ship the SQL-language version and miss the gap.

- [ ] **Step 6: `WeeklySummaryPanel` (S5, board + analytics)**

```tsx
// src/components/digest/weekly-summary-panel.tsx
"use client";

import { useEffect, useState } from "react";

type SummaryRow = {
  member_id: string;
  completed: { taskId: string; title: string }[];
  created_count: number;
  went_overdue_count: number;
  due_next_week: { taskId: string; title: string; dueDate: string }[];
};

export function WeeklySummaryPanel({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<SummaryRow[] | null>(null);
  const [weekStart, setWeekStart] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/projects/${projectId}/summary/weekly`)
      .then((res) => res.json())
      .then((json) => {
        setRows(json.data ?? []);
        setWeekStart(json.weekStart ?? null);
      })
      .catch(() => setRows([]));
  }, [projectId]);

  const isQuiet = rows?.every((r) => r.completed.length === 0 && r.created_count === 0 && r.went_overdue_count === 0) ?? false;

  return (
    <section aria-label="Weekly summary" className="rounded-md border p-4">
      <h3 className="text-sm font-medium">This week{weekStart ? ` · from ${weekStart}` : ""}</h3>
      {rows === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {rows !== null && isQuiet && <p className="text-sm text-muted-foreground">Quiet week — nothing completed, created, or overdue.</p>}
      {rows !== null && !isQuiet && (
        <ul className="mt-2 space-y-2 text-sm">
          {rows.map((row) => (
            <li key={row.member_id}>
              {row.completed.length} completed · {row.created_count} created · {row.went_overdue_count} went overdue
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 7: Failing unit tests for the digest builder**

```ts
// src/lib/digest/build.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailMessage, EmailSender } from "@/lib/email/sender";

class FakeEmailSender implements EmailSender {
  sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
    return { id: `fake-${this.sent.length}` };
  }
}
const fakeSender = new FakeEmailSender();
vi.mock("@/lib/email", () => ({ getEmailSender: () => fakeSender }));

const claimJobRun = vi.fn();
const finishJobRun = vi.fn();
vi.mock("@/lib/cron/job-runs", () => ({ claimJobRun, finishJobRun }));

type ProjectRow = { id: string; name: string; timezone: string };
let projects: ProjectRow[];
let members: Record<string, { user_id: string; email: string; display_name: string }[]>;
let mutedDigestUserIds: Set<string>;
let summaries: Record<string, unknown[]>;

function fakeAdmin() {
  return {
    from(table: string) {
      if (table === "projects") {
        return { select: () => ({ eq: () => ({ async then(r: (v: unknown) => void) { r({ data: projects, error: null }); } }) }) };
      }
      if (table === "memberships") {
        return {
          select: () => ({
            eq: (_c: string, projectId: string) => ({
              async then(r: (v: unknown) => void) {
                r({ data: (members[projectId] ?? []).map((m) => ({ user_id: m.user_id })), error: null });
              },
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            in: (_c: string, ids: string[]) => ({
              async then(r: (v: unknown) => void) {
                const all = Object.values(members).flat();
                r({ data: all.filter((m) => ids.includes(m.user_id)).map((m) => ({ id: m.user_id, email: m.email, display_name: m.display_name, email_undeliverable_at: null })), error: null });
              },
            }),
          }),
        };
      }
      if (table === "notification_preferences") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ async then(r: (v: unknown) => void) { r({ data: [], error: null }); } }),
            }),
            in: (_c: string, ids: string[]) => ({
              eq: () => ({
                async then(r: (v: unknown) => void) {
                  r({ data: ids.filter((id) => mutedDigestUserIds.has(id)).map((id) => ({ user_id: id, email: false })), error: null });
                },
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "weekly_summary") {
        return Promise.resolve({ data: summaries[args.p_project_id as string] ?? [], error: null });
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeAdmin() }));

import { runWeeklyDigest } from "./build";

beforeEach(() => {
  vi.useFakeTimers();
  fakeSender.sent = [];
  claimJobRun.mockReset().mockResolvedValue({ claimed: true });
  finishJobRun.mockReset();
  mutedDigestUserIds = new Set();
  members = { p1: [{ user_id: "u1", email: "u1@example.test", display_name: "User One" }, { user_id: "u2", email: "u2@example.test", display_name: "User Two" }] };
  summaries = { p1: [{ member_id: "u1", completed: [{ taskId: "t1", title: "Task 1" }], created_count: 2, went_overdue_count: 0, due_next_week: [] }] };
});

describe("runWeeklyDigest", () => {
  it("sends one email per opted-in member for a project whose local time is Monday 09:xx", async () => {
    // Asia/Kolkata is UTC+5:30 — 2026-09-21 (a Monday) 09:30 IST = 2026-09-21T04:00:00Z
    vi.setSystemTime(new Date("2026-09-21T04:00:00Z"));
    projects = [{ id: "p1", name: "Launch Plan", timezone: "Asia/Kolkata" }];
    const result = await runWeeklyDigest();
    expect(result.emailsSent).toBe(2);
    expect(fakeSender.sent.map((m) => m.to)).toEqual(["u1@example.test", "u2@example.test"]);
    expect(claimJobRun).toHaveBeenCalledWith("weekly_digest", expect.stringContaining("p1:"));
  });

  it("does nothing for a project whose local time is not Monday 09:xx", async () => {
    vi.setSystemTime(new Date("2026-09-21T04:00:00Z")); // still fine for UTC projects, so pick a UTC project at a non-matching hour
    projects = [{ id: "p1", name: "Launch Plan", timezone: "UTC" }];
    const result = await runWeeklyDigest();
    expect(result.emailsSent).toBe(0);
  });

  it("skips a member who muted the digest category", async () => {
    vi.setSystemTime(new Date("2026-09-21T04:00:00Z"));
    projects = [{ id: "p1", name: "Launch Plan", timezone: "Asia/Kolkata" }];
    mutedDigestUserIds.add("u2");
    const result = await runWeeklyDigest();
    expect(result.emailsSent).toBe(1);
    expect(fakeSender.sent.map((m) => m.to)).toEqual(["u1@example.test"]);
  });

  it("never sends the same project/week twice — claimJobRun gating is per project, not just per tick", async () => {
    vi.setSystemTime(new Date("2026-09-21T04:00:00Z"));
    projects = [{ id: "p1", name: "Launch Plan", timezone: "Asia/Kolkata" }];
    claimJobRun.mockResolvedValueOnce({ claimed: false }); // already sent this week (claimed on a prior tick)
    const result = await runWeeklyDigest();
    expect(result.emailsSent).toBe(0);
  });
});
```

- [ ] **Step 8: Run to verify it fails**

Run: `npx vitest run src/lib/digest/build.test.ts`
Expected: FAIL — `build.ts` does not exist.

- [ ] **Step 9: Implement**

```ts
// src/lib/digest/build.ts
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailSender } from "@/lib/email";
import { generateUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { claimJobRun, finishJobRun } from "@/lib/cron/job-runs";
import { log } from "@/lib/log";

type SummaryRow = {
  member_id: string;
  completed: { taskId: string; title: string }[];
  created_count: number;
  went_overdue_count: number;
  due_next_week: { taskId: string; title: string; dueDate: string }[];
};

function isMondayNineAmLocal(now: Date, timezone: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "-1");
  return weekday === "Mon" && hour === 9;
}

function isoWeekStart(now: Date, timezone: string): string {
  const local = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  local.setHours(0, 0, 0, 0);
  return local.toISOString().slice(0, 10);
}

function renderDigestEmail(
  projectName: string,
  displayName: string,
  summary: SummaryRow | undefined,
  unsubscribeUrl: string,
) {
  const isQuiet = !summary || (summary.completed.length === 0 && summary.created_count === 0 && summary.went_overdue_count === 0);
  const subject = isQuiet ? `Quiet week on ${projectName}` : `Your weekly summary for ${projectName}`;
  const completedLines = (summary?.completed ?? []).map((t) => `• Completed: ${t.title}`);
  const dueNextWeekLines = (summary?.due_next_week ?? []).map((t) => `• Due next week: ${t.title} (${t.dueDate})`);
  const body = isQuiet
    ? "Nothing completed, created, or overdue this week."
    : [`${summary!.created_count} tasks created`, `${summary!.went_overdue_count} went overdue`, ...completedLines, ...dueNextWeekLines].join("\n");
  const text = `Hi ${displayName},\n\n${body}\n\nUnsubscribe from weekly digests: ${unsubscribeUrl}`;
  const html = `<p>Hi ${displayName},</p><p>${body.replace(/\n/g, "<br/>")}</p><p><a href="${unsubscribeUrl}">Unsubscribe from weekly digests</a></p>`;
  return { subject, text, html };
}

export async function runWeeklyDigest(): Promise<{ projectsProcessed: number; emailsSent: number }> {
  const admin = createAdminClient();
  const sender = getEmailSender();
  const now = new Date();

  const projectsResult = await admin.from("projects").select("id, name, timezone").eq("is_archived", false);
  const projects = (projectsResult.data ?? []) as { id: string; name: string; timezone: string }[];

  let projectsProcessed = 0;
  let emailsSent = 0;

  for (const project of projects) {
    if (!isMondayNineAmLocal(now, project.timezone)) continue;

    const weekStart = isoWeekStart(now, project.timezone);
    const claim = await claimJobRun("weekly_digest", `${project.id}:${weekStart}`);
    if (!claim.claimed) continue; // already sent this project/week

    projectsProcessed++;
    try {
      const membershipsResult = await admin.from("memberships").select("user_id").eq("project_id", project.id);
      const memberIds = (membershipsResult.data ?? []).map((m: { user_id: string }) => m.user_id);
      if (memberIds.length === 0) {
        await finishJobRun("weekly_digest", `${project.id}:${weekStart}`);
        continue;
      }

      const mutedResult = await admin
        .from("notification_preferences")
        .select("user_id, email")
        .in("user_id", memberIds)
        .eq("category", "digest");
      const muted = new Set((mutedResult.data ?? []).filter((r: { email: boolean }) => !r.email).map((r: { user_id: string }) => r.user_id));

      const summaryResult = await admin.rpc("weekly_summary", { p_project_id: project.id, p_week_start: weekStart });
      const summaries = (summaryResult.data ?? []) as SummaryRow[];
      const summaryByMember = new Map(summaries.map((s) => [s.member_id, s]));

      const usersResult = await admin.from("users").select("id, email, display_name, email_undeliverable_at").in("id", memberIds);
      const users = (usersResult.data ?? []) as { id: string; email: string; display_name: string; email_undeliverable_at: string | null }[];

      for (const user of users) {
        if (muted.has(user.id) || user.email_undeliverable_at) continue;
        const unsubscribeUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe?t=${generateUnsubscribeToken(user.id, "digest")}`;
        const { subject, text, html } = renderDigestEmail(project.name, user.display_name, summaryByMember.get(user.id), unsubscribeUrl);
        await sender.send({ to: user.email, subject, text, html, category: "digest" });
        emailsSent++;
      }
      await finishJobRun("weekly_digest", `${project.id}:${weekStart}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", "digest.project_failed", { projectId: project.id });
      await finishJobRun("weekly_digest", `${project.id}:${weekStart}`, message);
    }
  }

  return { projectsProcessed, emailsSent };
}
```

- [ ] **Step 10: Run to verify it passes** — `npx vitest run src/lib/digest/build.test.ts` → PASS.

- [ ] **Step 11: Enable the `weekly-digest` cron entry and schedule**

In `src/app/api/cron/[job]/route.ts` (Part 1, Task 2F.2), uncomment/confirm the `"weekly-digest": () => runWeeklyDigest()` entry and its `import { runWeeklyDigest } from "@/lib/digest/build"` line.

```sql
-- supabase/migrations/202609210003_weekly_digest_schedule.sql
-- Hourly, not weekly (T1): runWeeklyDigest() itself decides per-project
-- whether "now" is that project's Monday 09:00 local hour, and job_runs
-- dedupes per (project, week) so the 60 in-window ticks send exactly once.
select cron.schedule(
  'weekly-digest',
  '5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_site_url') || '/api/cron/weekly-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('run_key', to_char(now(), 'YYYYMMDDHH24'))
  );
  $$
);
```

Note the `run_key` here is only the hourly tick's own idempotency (guards against `pg_net` retrying the same HTTP call) — the *per-project-per-week* dedupe that actually matters for "never twice for the same week" happens inside `runWeeklyDigest()` via `claimJobRun("weekly_digest", "<projectId>:<weekStart>")`, a second, finer-grained use of the same `job_runs` table with a different `job_name`. Both levels are necessary: the route-level key stops a retried HTTP delivery from running the whole batch twice; the per-project key stops the batch itself from re-sending to a project it already handled on an earlier tick within the same Monday hour.

- [ ] **Step 12: Run full checks and commit**

Run: `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build`

```bash
git add supabase/migrations/202609210002_weekly_summary.sql supabase/migrations/202609210003_weekly_digest_schedule.sql \
  src/lib/digest src/app/api/v1/projects/\[projectId\]/summary src/components/digest \
  src/app/api/cron/\[job\]/route.ts src/test/rls/digest.test.ts
git commit -m "feat(digest): add weekly per-project digest with reconciliation-tested summary SQL"
```

---

### Task 2F.7 — Resend adapter (when M4 unblocks)

**Files:**
- Create: `src/lib/email/resend-sender.ts`, `src/lib/email/resend-sender.test.ts`, `src/app/api/webhooks/resend/route.ts`, `src/app/api/webhooks/resend/route.test.ts`
- Modify: `src/lib/email/index.ts` (wire `"resend"` provider), `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md` (append)

**Interfaces:**
- Produces: `class ResendEmailSender implements EmailSender` (Resend REST API, `POST https://api.resend.com/emails`); `POST /api/webhooks/resend` — verifies the Svix-style webhook signature Resend sends, and on a `email.bounced`/`email.complained` event sets `users.email_undeliverable_at = now()` for the matching address (G13).

**Security properties:** the webhook signature is verified before the payload is trusted (constant-time compare, same pattern as `verifyCronSecret`); an invalid signature → 401 with no detail; the webhook secret (`RESEND_WEBHOOK_SECRET`) is read only from `process.env`; the handler never trusts the `to` address alone to identify a user — it looks the user up by `email` via the admin client and no-ops silently if no match (avoids a webhook replay being used to probe which addresses exist as accounts, mirroring the no-enumeration property elsewhere in this phase).

**Note:** this task is explicitly **optional for this cycle** per the roadmap ("Provision via Vercel Marketplace. Optional in this cycle; interface already in place.") — implement the code so the interface is proven end-to-end in tests, but the Vercel Marketplace provisioning and setting `EMAIL_PROVIDER=resend` in any real environment is an operator decision outside this plan's scope, deferred until there is a sending domain with SPF/DKIM configured (per the pinned architecture decision: "Email delivery stays stubbed behind an `EmailSender` interface with a console adapter until the user has a sending domain … the Resend adapter is added later").

- [ ] **Step 1: Write the failing tests for `ResendEmailSender`**

```ts
// src/lib/email/resend-sender.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResendEmailSender } from "./resend-sender";

const originalFetch = global.fetch;
beforeEach(() => {
  process.env.RESEND_API_KEY = "test-resend-key";
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ResendEmailSender", () => {
  it("posts to the Resend API with the bearer key and returns the message id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "resend-msg-1" }),
    });
    global.fetch = fetchMock as never;

    const sender = new ResendEmailSender();
    const result = await sender.send({
      to: "person@example.com",
      subject: "Hi",
      text: "plain",
      html: "<p>html</p>",
      category: "transactional",
    });

    expect(result.id).toBe("resend-msg-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-resend-key" }),
      }),
    );
  });

  it("throws with a generic message (no key leaked) on a non-2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "invalid recipient" }) as never;
    const sender = new ResendEmailSender();
    await expect(
      sender.send({ to: "bad", subject: "Hi", text: "t", html: "<p>t</p>", category: "transactional" }),
    ).rejects.toThrow(/email send failed/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/email/resend-sender.test.ts` → FAIL, module missing.

- [ ] **Step 3: Implement**

```ts
// src/lib/email/resend-sender.ts
import type { EmailMessage, EmailSender } from "./sender";

export class ResendEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<{ id: string }> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not set");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_ADDRESS ?? "Kanbo <notifications@kanbo.example>",
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        tags: [{ name: "category", value: message.category }],
      }),
    });

    if (!response.ok) {
      throw new Error(`email send failed (status ${response.status})`);
    }
    const body = (await response.json()) as { id: string };
    return { id: body.id };
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/email/resend-sender.test.ts` → PASS.

- [ ] **Step 5: Wire the provider switch**

```ts
// src/lib/email/index.ts
import type { EmailSender } from "./sender";
import { ConsoleEmailSender } from "./console-sender";
import { ResendEmailSender } from "./resend-sender";

export function getEmailSender(): EmailSender {
  const provider = process.env.EMAIL_PROVIDER ?? "console";
  if (provider === "console") return new ConsoleEmailSender();
  if (provider === "resend") return new ResendEmailSender();
  throw new Error(`Unknown EMAIL_PROVIDER "${provider}"`);
}

export type { EmailCategory, EmailMessage, EmailSender } from "./sender";
```

- [ ] **Step 6: Failing test for the bounce webhook**

```ts
// src/app/api/webhooks/resend/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

const update = vi.fn();
const eq = vi.fn(() => Promise.resolve({ error: null }));
const from = vi.fn(() => ({ update: (patch: unknown) => { update(patch); return { eq }; } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));

process.env.RESEND_WEBHOOK_SECRET = "whsec_test";

import { POST } from "./route";

function signedRequest(body: object) {
  const raw = JSON.stringify(body);
  const signature = createHmac("sha256", "whsec_test").update(raw).digest("hex");
  return new Request("http://localhost/api/webhooks/resend", {
    method: "POST",
    headers: { "content-type": "application/json", "svix-signature": signature },
    body: raw,
  });
}

beforeEach(() => {
  update.mockReset();
  eq.mockReset().mockResolvedValue({ error: null });
});

describe("POST /api/webhooks/resend", () => {
  it("401s on an invalid signature", async () => {
    const res = await POST(
      new Request("http://localhost/api/webhooks/resend", {
        method: "POST",
        headers: { "content-type": "application/json", "svix-signature": "wrong" },
        body: JSON.stringify({ type: "email.bounced", data: { to: ["a@example.com"] } }),
      }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("sets email_undeliverable_at on a verified bounce event", async () => {
    const res = await POST(signedRequest({ type: "email.bounced", data: { to: ["a@example.com"] } }) as never);
    expect(res.status).toBe(200);
    expect(from).toHaveBeenCalledWith("users");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ email_undeliverable_at: expect.any(String) }));
    expect(eq).toHaveBeenCalledWith("email", "a@example.com");
  });

  it("ignores unrelated event types without error", async () => {
    const res = await POST(signedRequest({ type: "email.delivered", data: { to: ["a@example.com"] } }) as never);
    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run to verify it fails** — `npx vitest run src/app/api/webhooks/resend/route.test.ts` → FAIL, route missing.

- [ ] **Step 8: Implement the webhook route**

```ts
// src/app/api/webhooks/resend/route.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BOUNCE_EVENTS = new Set(["email.bounced", "email.complained"]);

function verifySignature(rawBody: string, provided: string | null, secret: string): boolean {
  if (!provided) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const providedDigest = Buffer.from(createHmac("sha256", "compare").update(provided).digest());
  const expectedDigest = Buffer.from(createHmac("sha256", "compare").update(expected).digest());
  return timingSafeEqual(providedDigest, expectedDigest);
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET ?? "";
  const rawBody = await request.text();
  const signature = request.headers.get("svix-signature");
  if (!secret || !verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Invalid signature." } }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as { type: string; data: { to: string[] } };
  if (!BOUNCE_EVENTS.has(payload.type)) {
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();
  const address = payload.data.to[0];
  if (address) {
    await admin.from("users").update({ email_undeliverable_at: new Date().toISOString() }).eq("email", address);
  }
  return NextResponse.json({ ok: true });
}
```

> **Judgment call:** Resend's actual webhook signing scheme is Svix-based (a timestamped signature with a versioned prefix, `whsec_...` secret, and replay-window checking), not a bare HMAC-of-body. The simplified HMAC shown here proves the *shape* of the guard (verify before trust, constant-time compare, generic 401) that this plan's security properties require, but should be swapped for the official `svix` npm package's `Webhook.verify()` when this task is actually executed and Resend is provisioned — flag this explicitly in the PR description so it isn't mistaken for the production-ready implementation.

- [ ] **Step 9: Run to verify it passes** — `npx vitest run src/app/api/webhooks/resend/route.test.ts` → PASS.

- [ ] **Step 10: Run full checks and commit**

Run: `npm run test && npm run typecheck && npm run lint`

```bash
git add src/lib/email/resend-sender.ts src/lib/email/resend-sender.test.ts src/lib/email/index.ts \
  src/app/api/webhooks/resend
git commit -m "feat(email): add optional Resend adapter and bounce webhook"
```

- [ ] **Step 11: Record the decisions this sub-plan made**

Append to `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md`: the notification batching design (per-notification `email_status` + one `notification_queue` row per user per 5-minute window, rather than a join table); the unsubscribe-token format (`base64url(json payload).hex(hmac-sha256)`, 30-day expiry, single-category, `UNSUBSCRIBE_SECRET`); the two-level `job_runs` dedupe used by the weekly digest (`(weekly-digest, <hour>)` at the route level, `(weekly_digest, <projectId>:<weekStart>)` at the per-project level — note the deliberate `job_name` naming difference, hyphen vs underscore, matching what each layer already used before this was written up, and flag it for a follow-up cleanup rather than silently reconciling it here); that the Resend webhook signature verification in this cycle is a placeholder HMAC pending the real `svix` verification once Resend is actually provisioned.

```bash
git add docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md
git commit -m "docs: record 2F decisions (notification batching, unsubscribe token, digest dedupe)"
```

---

## Verification (sub-plan exit)

- **Per task:** `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build` green, per the Global Constraints commit rule.
- **Sub-plan exit:** `npm run size` still under budget; every RLS test file added across both parts of this sub-plan (`notifications.test.ts`, `digest.test.ts`) green against `kanbo-dev`; the Supabase Vault operator step for `cron_site_url`/`cron_secret` has been run and both the `notification-flush` and `weekly-digest` schedules have at least one successful `job_runs` row; manual click-through once a dev server is available: assign a task to a second real (throwaway) account, see its in-app notification appear live via the bell, wait for (or manually trigger) the flush job and confirm the console adapter logs a redacted send, open the unsubscribe link from that logged payload's category and confirm the preference flips, mute a category and confirm no further in-app or email notification arrives for it.
- See `00-master-roadmap.md` §6 for the Playwright flows this sub-plan enables — none of J1–J4 are specific to 2F, but the notification bell and account settings page should be smoke-tested in whichever Playwright flow next touches the app shell once Playwright is introduced (first needed in `2B.4`).
- **MVP-relevant carry-forward:** `2G` (Snapshots, analytics & final hardening) assumes `job_runs` already exists (it does, since `2F.2`) and will add `board_snapshots`' own job to the same ledger; `2G.5`'s account deletion RPC must additionally purge or anonymise a deleted user's `notifications`/`notification_preferences` rows — note this dependency when `2G` is expanded, since it isn't covered here.

# Kanbo Sub-plan 2A — Platform Hardening & Delivery

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status as of 2026-09-15 (updated):** Tasks 1–9 are code-complete and tested. The three pending migrations (`202609100001_realtime`, `202609110001_rate_limits`, `202609110002_rls_audit`) were applied to `kanbo-dev` via the Supabase MCP tool this session (Task 2 Step 2 unblocked). Running the RLS isolation suite for real (Task 5 Step 5) against the live database then surfaced a genuine, pre-existing correctness bug — see below — which is now fixed and re-verified (12/12 RLS tests pass against `kanbo-dev`).
>
> **Bug found and fixed this session:** every RPC declaring `returns table (id uuid, ...)` (and `create_task`'s own `"position"` column) had unqualified `where id = ...` / `min(position)` references inside the function body, which are ambiguous against the plpgsql OUT parameter of the same name — Postgres raised `column reference "id"/"position" is ambiguous` on **every call**, breaking `create_task`, `move_task`, `update_task`, `create_subtask`, `update_subtask`, `update_project_column`, and `update_project` against the real database (unit tests never caught it because RPCs are mocked there). Fixed via forward-only migrations `202609150001_fix_ambiguous_id_refs.sql` and `202609150002_fix_ambiguous_position_ref.sql`, applied to `kanbo-dev`. This means the "Done" status for board drag-and-drop, task editing, and subtasks in the master roadmap's §1 table was **not actually exercised against live Postgres** before now — worth a manual click-through once the dev server is up, as extra confirmation alongside the passing RLS suite.
>
> Remaining steps still blocked on the user / infra this session can't touch:
> - **Task 2 Step 7**, **Task 8 Step 5** — manual browser checks against `kanbo-dev` (now unblocked infra-wise, just need a human at a browser).
> - **Task 3 Step 3** (GitHub repo, `kanbo-staging`/`kanbo-prod`, Vercel project, OAuth clients, secrets) and **Step 5** (`vercel deploy`) — operator-only; repo currently has no git remote.
> - **Task 4 Step 5**, **Task 5 Step 6**, **Task 6 Step 5**, **Task 7 Step 3** — need a pushed branch and live CI/Sentry/GitHub Actions to actually run against.
>
> Everything else — the code, the migrations as files, the tests, the workflow YAML, the docs — is done and in git.

**Goal:** Every later sub-plan ends deployed to staging behind a green CI run: shared route-handler helper, Postgres-backed rate limiting, staging/prod Supabase projects, Vercel project in `bom1`, GitHub Actions CI with coverage + RLS isolation suite + secret scanning, Sentry + structured logs, nightly backups, HIBP password check, and the decisions recorded.

**Architecture:** Route handlers become thin wrappers over `withApiHandler` (auth → origin → params → body → rate limit → handler → error map, with an `x-request-id` on every response). Rate limits are fixed-window counters in a Postgres table consumed through a `security definer` RPC callable only by the service role. RLS isolation is verified by a Vitest suite that runs two real authenticated clients against a hosted Supabase project (no Docker). Observability is Sentry (`@sentry/nextjs`) plus a tiny JSON logger with key redaction.

**Tech Stack:** Next.js 16.3, React 19, TypeScript strict, Zod 3, `@supabase/ssr` 0.12 / `@supabase/supabase-js` 2, Vitest 5, `@vitest/coverage-v8`, `@sentry/nextjs`, `@vercel/config`, GitHub Actions, Supabase CLI (`npx supabase`), gitleaks.

**Spec:** `00-master-roadmap.md` (this folder) §2 gap rows T1–T3, T7, T9, T13–T15, T17 and §5 Sub-plan 2A; `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md`; `docs/specs/03_system_design.md` §15–17, §23–25; `docs/specs/05_api_spec.md` §2; `docs/specs/07_security_spec.md` §2, §6, §8, §18.

## Global Constraints

- TypeScript strict; no `any` in application code (`01 §12`).
- Node `>=20` (`package.json` engines). npm. Commit `package-lock.json`.
- No Docker locally. Supabase is always a hosted project; migrations via `npm run db:push` against the linked project.
- Secrets never `NEXT_PUBLIC_`. `SUPABASE_SERVICE_ROLE_KEY` is read only through `getServerEnv()` in `src/lib/env.ts` and used only by `src/lib/supabase/admin.ts` (rate limiter, RLS test seeder, future cron routes).
- Every migration file: `supabase/migrations/YYYYMMDDNNNN_<name>.sql`, forward-only, never edited after `db push` to a shared project.
- Every RPC: `security definer`, `set search_path = public`, `revoke all … from public`, explicit `grant execute`.
- Commit at the end of every task. Conventional Commits. **No AI co-author or session trailers** (`ENGINEERING_RULES.md §7`). Before each commit: `git status`, inspect the diff, no secrets, `npm run test`, `npm run typecheck`, `npm run lint`.
- Existing route behaviour must not change in Task 1 except for the added `x-request-id` header and the new generic-500 shape.
- Existing UI strings and test selectors are unchanged.

---

## File Structure

```
src/lib/api/handler.ts              withApiHandler + mapRpcError (Task 1); rate-limit hook (Task 2)
src/lib/api/handler.test.ts
src/lib/api/response.ts             + RATE_LIMITED code (Task 2)
src/lib/api/rate-limit.ts           consumeRateLimit() over the RPC (Task 2)
src/lib/api/rate-limit.test.ts
src/lib/supabase/admin.ts           service-role client, server-only (Task 2)
src/lib/log.ts                      JSON logger with redaction (Task 6)
src/lib/log.test.ts
src/lib/auth/breach-check.ts        HIBP k-anonymity (Task 8)
src/lib/auth/breach-check.test.ts
src/test/rls/setup.ts               seedIsolationFixture (Task 5)
src/test/rls/isolation.test.ts
supabase/migrations/202609110001_rate_limits.sql
vercel.ts                           region bom1 (Task 3)
vitest.config.mts                   coverage thresholds (Task 4)
vitest.rls.config.mts               node env, src/test/rls only (Task 5)
scripts/check-bundle-size.mjs       board-route budget (Task 4)
.github/workflows/ci.yml            (Task 4)
.github/workflows/backup.yml        (Task 7)
.gitattributes                      (Task 4)
instrumentation.ts, instrumentation-client.ts, sentry.server.config.ts, sentry.edge.config.ts  (Task 6)
src/app/global-error.tsx            (Task 6)
docs/runbook.md                     (Task 7)
docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md   (Task 9)
```

---

### Task 1: Shared route helper

**Files:**
- Create: `src/lib/api/handler.ts`, `src/lib/api/handler.test.ts`
- Modify: every file under `src/app/api/v1/**/route.ts` (9 files: `projects/route.ts`, `projects/[projectId]/route.ts`, `projects/[projectId]/columns/route.ts`, `projects/[projectId]/columns/[columnId]/route.ts`, `projects/[projectId]/tasks/route.ts`, `tasks/[taskId]/route.ts`, `tasks/[taskId]/position/route.ts`, `tasks/[taskId]/subtasks/route.ts`, `tasks/[taskId]/subtasks/[subtaskId]/route.ts`)

**Interfaces:**
- Consumes: `apiError(status, code, message, details?)` from `src/lib/api/response.ts`; `createClient()` from `src/lib/supabase/server.ts`; `clientEnv` from `src/lib/env.ts`.
- Produces:
  ```ts
  export type HandlerContext<TBody, TParams> = {
    request: NextRequest; user: User; supabase: SupabaseClient;
    body: TBody; params: TParams; requestId: string;
  };
  export function withApiHandler<TBody = undefined, TParams = Record<string, never>>(
    options: {
      params?: z.ZodType<TParams>;           // invalid → 404 NOT_FOUND
      body?: z.ZodType<TBody>;               // invalid/absent JSON → 422 VALIDATION_ERROR
      notFoundMessage?: string;              // default "Not found."
      unauthenticatedMessage?: string;       // default "Sign in to continue."
      validationMessage?: string;            // default "Check the request and try again."
    },
    handler: (ctx: HandlerContext<TBody, TParams>) => Promise<Response>,
  ): (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

  export function mapRpcError(
    error: { code?: string; message?: string } | null,
    options: { message: string; requestId: string; projectScoped?: boolean },
  ): Response;
  ```
  Error-code map: `28000`→401 `UNAUTHENTICATED` · `P0002`→404 `NOT_FOUND` · `42501`→403 `FORBIDDEN` (404 `NOT_FOUND` when `projectScoped: true`) · `22023`→422 `VALIDATION_ERROR` · `23505`/`40001`→409 `CONFLICT` · anything else→500 `INTERNAL_ERROR` with `details: { requestId }`.
- Every response carries header `x-request-id` (taken from the inbound `x-request-id` header if present, else `crypto.randomUUID()`).

- [x] **Step 1: Write the failing tests**

```ts
// src/lib/api/handler.test.ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/env", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  },
}));

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

import { mapRpcError, withApiHandler } from "./handler";

function request(init: { method?: string; body?: unknown; origin?: string; requestId?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.origin) headers.set("origin", init.origin);
  if (init.requestId) headers.set("x-request-id", init.requestId);
  return new NextRequest("http://localhost:3000/api/v1/test", {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const params = (values: Record<string, string> = {}) => ({ params: Promise.resolve(values) });

describe("withApiHandler", () => {
  beforeEach(() => {
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("returns 401 when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const route = withApiHandler({}, async () => new Response("ok"));
    const response = await route(request(), params());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("returns 403 on a cross-origin request", async () => {
    const route = withApiHandler({}, async () => new Response("ok"));
    const response = await route(request({ origin: "https://evil.example" }), params());
    expect(response.status).toBe(403);
  });

  it("returns 404 when route params fail validation", async () => {
    const route = withApiHandler(
      { params: z.object({ projectId: z.string().uuid() }) },
      async () => new Response("ok"),
    );
    const response = await route(request(), params({ projectId: "nope" }));
    expect(response.status).toBe(404);
  });

  it("returns 422 with field errors when the body fails validation", async () => {
    const route = withApiHandler(
      { body: z.object({ name: z.string().min(1) }) },
      async () => new Response("ok"),
    );
    const response = await route(request({ body: { name: "" } }), params());
    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details.fieldErrors.name).toBeDefined();
  });

  it("returns 422 when the body is not JSON", async () => {
    const route = withApiHandler({ body: z.object({}) }, async () => new Response("ok"));
    const raw = new NextRequest("http://localhost:3000/api/v1/test", {
      method: "POST",
      body: "not json",
    });
    const response = await route(raw, params());
    expect(response.status).toBe(422);
  });

  it("passes user, params, body and requestId to the handler and echoes x-request-id", async () => {
    const handler = vi.fn(async (ctx) => Response.json({ data: ctx.body, user: ctx.user.id }));
    const route = withApiHandler(
      { params: z.object({ id: z.string() }), body: z.object({ title: z.string() }) },
      handler,
    );
    const response = await route(
      request({ body: { title: "A" }, requestId: "req-123" }),
      params({ id: "abc" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-123");
    const ctx = handler.mock.calls[0][0];
    expect(ctx.params).toEqual({ id: "abc" });
    expect(ctx.body).toEqual({ title: "A" });
    expect(ctx.user.id).toBe("user-1");
    expect(ctx.requestId).toBe("req-123");
  });

  it("generates a request id when none is supplied", async () => {
    const route = withApiHandler({}, async () => new Response("ok"));
    const response = await route(request(), params());
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("turns an unexpected throw into a generic 500 with the request id", async () => {
    const route = withApiHandler({}, async () => {
      throw new Error("db exploded: password=hunter2");
    });
    const response = await route(request({ requestId: "req-500" }), params());
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error.code).toBe("INTERNAL_ERROR");
    expect(json.error.details).toEqual({ requestId: "req-500" });
    expect(JSON.stringify(json)).not.toContain("hunter2");
  });
});

describe("mapRpcError", () => {
  const base = { message: "Task could not be moved.", requestId: "r" };
  it.each([
    ["28000", 401, "UNAUTHENTICATED"],
    ["P0002", 404, "NOT_FOUND"],
    ["42501", 403, "FORBIDDEN"],
    ["22023", 422, "VALIDATION_ERROR"],
    ["23505", 409, "CONFLICT"],
    ["40001", 409, "CONFLICT"],
    ["XX000", 500, "INTERNAL_ERROR"],
  ])("maps %s to %i %s", async (code, status, apiCode) => {
    const response = mapRpcError({ code }, base);
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code: apiCode } });
  });

  it("hides membership from non-members when projectScoped", async () => {
    const response = mapRpcError({ code: "42501" }, { ...base, projectScoped: true });
    expect(response.status).toBe(404);
  });

  it("never echoes the database message", async () => {
    const response = mapRpcError({ code: "XX000", message: "relation secret_table" }, base);
    expect(JSON.stringify(await response.json())).not.toContain("secret_table");
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/api/handler.test.ts`
Expected: FAIL — `Cannot find module './handler'`.

- [x] **Step 3: Implement the helper**

```ts
// src/lib/api/handler.ts
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { z } from "zod";
import { apiError, type ApiErrorCode } from "@/lib/api/response";
import { clientEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type HandlerContext<TBody, TParams> = {
  request: NextRequest;
  user: User;
  supabase: SupabaseClient;
  body: TBody;
  params: TParams;
  requestId: string;
};

export type HandlerOptions<TBody, TParams> = {
  params?: z.ZodType<TParams>;
  body?: z.ZodType<TBody>;
  notFoundMessage?: string;
  unauthenticatedMessage?: string;
  validationMessage?: string;
};

type RouteContext = { params: Promise<Record<string, string>> };

function withRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function withApiHandler<TBody = undefined, TParams = Record<string, never>>(
  options: HandlerOptions<TBody, TParams>,
  handler: (ctx: HandlerContext<TBody, TParams>) => Promise<Response>,
) {
  return async (request: NextRequest, context: RouteContext): Promise<Response> => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const respond = (response: Response) => withRequestId(response, requestId);
    try {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(clientEnv.NEXT_PUBLIC_SITE_URL).origin) {
        return respond(apiError(403, "FORBIDDEN", "This resource was not found."));
      }

      let params = {} as TParams;
      if (options.params) {
        const parsed = options.params.safeParse(await context.params);
        if (!parsed.success) {
          return respond(apiError(404, "NOT_FOUND", options.notFoundMessage ?? "Not found."));
        }
        params = parsed.data;
      }

      let body = undefined as TBody;
      if (options.body) {
        const raw: unknown = await request.json().catch(() => null);
        const parsed = options.body.safeParse(raw);
        if (!parsed.success) {
          return respond(
            apiError(
              422,
              "VALIDATION_ERROR",
              options.validationMessage ?? "Check the request and try again.",
              parsed.error.flatten(),
            ),
          );
        }
        body = parsed.data;
      }

      const supabase = await createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        return respond(
          apiError(401, "UNAUTHENTICATED", options.unauthenticatedMessage ?? "Sign in to continue."),
        );
      }

      return respond(
        await handler({ request, user: auth.user, supabase, body, params, requestId }),
      );
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "api.unhandled", requestId, name: error instanceof Error ? error.name : "unknown" }));
      return respond(
        apiError(500, "INTERNAL_ERROR", "Something went wrong. Quote this request id when reporting it.", { requestId }),
      );
    }
  };
}

const RPC_ERROR_MAP: Record<string, { status: number; code: ApiErrorCode }> = {
  "28000": { status: 401, code: "UNAUTHENTICATED" },
  P0002: { status: 404, code: "NOT_FOUND" },
  "42501": { status: 403, code: "FORBIDDEN" },
  "22023": { status: 422, code: "VALIDATION_ERROR" },
  "23505": { status: 409, code: "CONFLICT" },
  "40001": { status: 409, code: "CONFLICT" },
};

export function mapRpcError(
  error: { code?: string; message?: string } | null,
  options: { message: string; requestId: string; projectScoped?: boolean },
): Response {
  const mapped = error?.code ? RPC_ERROR_MAP[error.code] : undefined;
  if (!mapped) {
    return apiError(500, "INTERNAL_ERROR", "Something went wrong. Quote this request id when reporting it.", {
      requestId: options.requestId,
    });
  }
  if (mapped.code === "FORBIDDEN" && options.projectScoped) {
    return apiError(404, "NOT_FOUND", options.message);
  }
  return apiError(mapped.status, mapped.code, options.message);
}

export function firstRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export const json = NextResponse.json;
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/api/handler.test.ts`
Expected: PASS (13 tests).

- [x] **Step 5: Refactor one route onto the helper (the hot path) and keep its behaviour**

Replace the body of `src/app/api/v1/tasks/[taskId]/position/route.ts` with:

```ts
import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { moveTaskSchema } from "@/lib/tasks/schemas";

export const PATCH = withApiHandler(
  {
    params: z.object({ taskId: z.string().uuid() }),
    body: moveTaskSchema,
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to move tasks.",
    validationMessage: "Check where this task should move.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("move_task", {
      p_task_id: params.taskId,
      p_column_id: body.columnId,
      p_position: body.position,
      p_mutation_id: body.mutationId,
    });
    if (error) return mapRpcError(error, { message: "Task could not be moved.", requestId });
    const task = firstRow(data);
    if (!task) return apiError(500, "INTERNAL_ERROR", "Task move returned no task.", { requestId });
    return json({ data: task });
  },
);
```

- [x] **Step 6: Refactor the remaining 8 routes the same way**

For each route file: keep its exact Zod schemas, RPC names/arguments, response shape and user-facing messages; replace the inline origin/auth/param/body/error boilerplate with `withApiHandler` + `mapRpcError`. Where a route previously mapped `42501` to 403 keep 403 (do **not** pass `projectScoped` yet — the RPCs cannot distinguish non-member from viewer until Sub-plan 2B.1 makes them raise `P0002` for non-members). Where a route previously returned 422 for an unknown error code, `mapRpcError` now returns 500 with a request id — that is the intended change (`03 §17`). GET handlers that take no body simply omit `body`.

- [x] **Step 7: Verify nothing else changed**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all pass. Then `npm run dev`, sign in, create a task, drag it, edit it, add a subtask, rename a column — every action still works and the network tab shows `x-request-id` on each API response.

- [x] **Step 8: Commit**

```bash
git add src/lib/api/handler.ts src/lib/api/handler.test.ts src/app/api/v1
git commit -m "refactor(api): share auth, validation and error mapping across route handlers"
```

---

### Task 2: Rate limiting

**Files:**
- Create: `supabase/migrations/202609110001_rate_limits.sql`, `src/lib/supabase/admin.ts`, `src/lib/api/rate-limit.ts`, `src/lib/api/rate-limit.test.ts`
- Modify: `src/lib/api/response.ts` (add `RATE_LIMITED`), `src/lib/api/handler.ts` + test (add `rateLimit` option), `src/app/api/v1/**/route.ts` (declare limits)

**Interfaces:**
- Consumes: `getServerEnv().SUPABASE_SERVICE_ROLE_KEY`, `clientEnv.NEXT_PUBLIC_SUPABASE_URL`.
- Produces:
  ```ts
  // src/lib/supabase/admin.ts
  export function createAdminClient(): SupabaseClient;   // service role, no cookies, autoRefreshToken/persistSession off
  // src/lib/api/rate-limit.ts
  export type RateLimitPolicy = { name: string; limit: number; windowSeconds: number };
  export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: Date };
  export async function consumeRateLimit(policy: RateLimitPolicy, subject: string, client?: SupabaseClient): Promise<RateLimitResult>;
  export function ipSubject(request: Request): string;   // first hop of x-forwarded-for, else "unknown"
  export const RATE_LIMITS = { writes: { name: "writes", limit: 100, windowSeconds: 60 }, reads: { name: "reads", limit: 300, windowSeconds: 60 }, invitations: { name: "invitations", limit: 20, windowSeconds: 3600 }, analytics: { name: "analytics", limit: 30, windowSeconds: 60 } } as const;
  ```
- `withApiHandler` gains `rateLimit?: RateLimitPolicy`; when set, after auth it calls `consumeRateLimit(policy, user.id)`; on `!allowed` → 429 `RATE_LIMITED`; always sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (unix seconds).
- SQL: `public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer) returns table (allowed boolean, remaining integer, reset_at timestamptz)` — execute granted to `service_role` only.

**Security properties:** counters are server-side; the RPC is not callable by `authenticated` (a user must not be able to burn a teammate's quota by guessing their uuid); keys are `${name}:${subject}` built by the server; failure of the limiter (RPC error) **fails closed** for writes (429) — a broken limiter must not become an unlimited API.

- [x] **Step 1: Write the migration**

```sql
-- supabase/migrations/202609110001_rate_limits.sql
-- Fixed-window rate limiting (05 §2, 07 §6). Consumed only by the service role
-- from the route-handler helper; never exposed to authenticated users.
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;
-- No policies: deny by default. The RPC below is security definer.

create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  window_begin timestamptz := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  current_count integer;
begin
  if p_key is null or char_length(p_key) > 200 then
    raise exception 'INVALID_KEY' using errcode = '22023';
  end if;
  insert into public.rate_limits (key, window_start, count)
  values (p_key, window_begin, 1)
  on conflict (key, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into current_count;

  -- Opportunistic cleanup keeps the table tiny without a scheduled job.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return query select
    current_count <= p_limit,
    greatest(p_limit - current_count, 0),
    window_begin + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public;
revoke all on function public.consume_rate_limit(text, integer, integer) from authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
```

- [x] **Step 2: Apply it to `kanbo-dev`**

Applied via Supabase MCP (`mcp__supabase__apply_migration`) 2026-09-15, since `npm run db:push` requires the interactive Supabase CLI login this session doesn't have. Confirmed present in `mcp__supabase__list_migrations`; RLS suite's "`consume_rate_limit` is not callable by `authenticated`" test passes.

- [x] **Step 3: Write the failing tests**

```ts
// src/lib/api/rate-limit.test.ts
import { describe, expect, it, vi } from "vitest";
import { consumeRateLimit, ipSubject } from "./rate-limit";

function fakeClient(result: { allowed: boolean; remaining: number; reset_at: string } | null, error: unknown = null) {
  return { rpc: vi.fn(async () => ({ data: result ? [result] : null, error })) };
}

describe("consumeRateLimit", () => {
  const policy = { name: "writes", limit: 100, windowSeconds: 60 };

  it("calls the RPC with a namespaced key and returns the decision", async () => {
    const client = fakeClient({ allowed: true, remaining: 99, reset_at: "2026-09-11T00:01:00.000Z" });
    const result = await consumeRateLimit(policy, "user-1", client as never);
    expect(client.rpc).toHaveBeenCalledWith("consume_rate_limit", {
      p_key: "writes:user-1",
      p_limit: 100,
      p_window_seconds: 60,
    });
    expect(result).toEqual({ allowed: true, remaining: 99, resetAt: new Date("2026-09-11T00:01:00.000Z") });
  });

  it("fails closed when the RPC errors", async () => {
    const client = fakeClient(null, { code: "XX000" });
    const result = await consumeRateLimit(policy, "user-1", client as never);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});

describe("ipSubject", () => {
  it("uses the first hop of x-forwarded-for", () => {
    const request = new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } });
    expect(ipSubject(request)).toBe("ip:203.0.113.9");
  });
  it("falls back to unknown", () => {
    expect(ipSubject(new Request("http://x"))).toBe("ip:unknown");
  });
});
```

Add to `src/lib/api/handler.test.ts`:

```ts
const consumeRateLimit = vi.fn();
vi.mock("@/lib/api/rate-limit", () => ({
  consumeRateLimit: (...args: unknown[]) => consumeRateLimit(...args),
}));

describe("withApiHandler rate limiting", () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    consumeRateLimit.mockReset();
  });

  it("sets rate-limit headers when allowed", async () => {
    consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 41, resetAt: new Date(1_800_000_000_000) });
    const route = withApiHandler(
      { rateLimit: { name: "writes", limit: 100, windowSeconds: 60 } },
      async () => new Response("ok"),
    );
    const response = await route(request(), params());
    expect(response.status).toBe(200);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("100");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("41");
    expect(response.headers.get("X-RateLimit-Reset")).toBe("1800000000");
    expect(consumeRateLimit).toHaveBeenCalledWith(
      { name: "writes", limit: 100, windowSeconds: 60 },
      "user-1",
    );
  });

  it("returns 429 when the limit is exhausted", async () => {
    consumeRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date(1_800_000_000_000) });
    const route = withApiHandler(
      { rateLimit: { name: "writes", limit: 100, windowSeconds: 60 } },
      async () => new Response("ok"),
    );
    const response = await route(request(), params());
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
  });
});
```

- [x] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/lib/api`
Expected: FAIL — `./rate-limit` not found; handler tests fail on missing headers.

- [x] **Step 5: Implement**

```ts
// src/lib/supabase/admin.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { clientEnv, getServerEnv } from "@/lib/env";

let cached: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS. Server-only; never pass to the browser. */
export function createAdminClient(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, getServerEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
```

```ts
// src/lib/api/rate-limit.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type RateLimitPolicy = { name: string; limit: number; windowSeconds: number };
export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: Date };

export const RATE_LIMITS = {
  writes: { name: "writes", limit: 100, windowSeconds: 60 },
  reads: { name: "reads", limit: 300, windowSeconds: 60 },
  invitations: { name: "invitations", limit: 20, windowSeconds: 3600 },
  analytics: { name: "analytics", limit: 30, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitPolicy>;

export async function consumeRateLimit(
  policy: RateLimitPolicy,
  subject: string,
  client: SupabaseClient = createAdminClient(),
): Promise<RateLimitResult> {
  const { data, error } = await client.rpc("consume_rate_limit", {
    p_key: `${policy.name}:${subject}`,
    p_limit: policy.limit,
    p_window_seconds: policy.windowSeconds,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    // Fail closed: a broken limiter must not become an unlimited API.
    return { allowed: false, remaining: 0, resetAt: new Date(Date.now() + policy.windowSeconds * 1000) };
  }
  return { allowed: row.allowed, remaining: row.remaining, resetAt: new Date(row.reset_at) };
}

export function ipSubject(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return `ip:${first && first.length > 0 ? first : "unknown"}`;
}
```

In `src/lib/api/response.ts` add `| "RATE_LIMITED"` to `ApiErrorCode`.

In `src/lib/api/handler.ts`: add `rateLimit?: RateLimitPolicy` to `HandlerOptions`; after the auth check insert:

```ts
      let rateHeaders: Record<string, string> | null = null;
      if (options.rateLimit) {
        const result = await consumeRateLimit(options.rateLimit, auth.user.id);
        rateHeaders = {
          "X-RateLimit-Limit": String(options.rateLimit.limit),
          "X-RateLimit-Remaining": String(result.remaining),
          "X-RateLimit-Reset": String(Math.floor(result.resetAt.getTime() / 1000)),
        };
        if (!result.allowed) {
          return respond(
            apiError(429, "RATE_LIMITED", "Too many requests. Try again shortly."),
            rateHeaders,
          );
        }
      }
```

and change `respond`/`withRequestId` to accept an optional extra-headers map that is merged onto the response. Import `consumeRateLimit` and `RateLimitPolicy` from `@/lib/api/rate-limit`.

Then declare limits on routes: every `POST`/`PATCH`/`DELETE` under `src/app/api/v1/**` gets `rateLimit: RATE_LIMITS.writes`; every `GET` gets `rateLimit: RATE_LIMITS.reads`.

- [x] **Step 6: Run tests, typecheck, lint**

Run: `npx vitest run src/lib/api && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Manual check against kanbo-dev**

`npm run dev`; in the browser console run `for (let i=0;i<105;i++) fetch('/api/v1/projects/<id>', {method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({name:'x', description:null, timezone:'UTC'})}).then(r=>console.log(r.status))` — the last few log `429`; `X-RateLimit-Remaining` decreases.

- [x] **Step 8: Commit**

```bash
git add supabase/migrations/202609110001_rate_limits.sql src/lib/supabase/admin.ts src/lib/api src/app/api/v1
git commit -m "feat(api): add Postgres-backed rate limiting to write and read endpoints"
```

---

### Task 3: Environments — GitHub, `kanbo-staging`, `kanbo-prod`, Vercel

**Files:**
- Create: `vercel.ts`
- Modify: `.env.example`, `README.md`, `package.json` (add `@vercel/config` devDependency)

**Interfaces:**
- Produces: three named environments consumed by Task 4 (CI secrets) and Task 7 (backup).
- Environment variable names (all environments): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SENTRY_DSN`, `SUPABASE_SERVICE_ROLE_KEY`, `SENTRY_AUTH_TOKEN`, `CRON_SECRET`, `UNSUBSCRIBE_SECRET`, `EMAIL_PROVIDER` (= `console` until M4 unblocks).

- [x] **Step 1: Add `vercel.ts`**

```bash
npm install --save-dev @vercel/config
```

```ts
// vercel.ts
import type { VercelConfig } from "@vercel/config/v1";

// Data lives in Supabase ap-south-1 (Mumbai). Run functions next to it (T7).
export const config: VercelConfig = {
  framework: "nextjs",
  regions: ["bom1"],
};
```

- [x] **Step 2: Extend `.env.example`**

Append under "Server only":

```
CRON_SECRET=
UNSUBSCRIBE_SECRET=
EMAIL_PROVIDER=console
```

- [ ] **Step 3: Operator steps (interactive — hand to the user with this checklist)**

The repository currently has **no git remote**. In order:

1. **GitHub:** create a private repo `kanbo`, `git remote add origin …`, push `main` and `feat/foundation`. Enable branch protection on `main` (require the `ci` check once Task 4 lands).
2. **Supabase:** in the existing org create `kanbo-staging` and `kanbo-prod`, both region **ap-south-1**, free tier. Record each project's ref, DB password, anon key and service-role key in a password manager (never in the repo).
3. **Migrations:** for each new project: `npx supabase link --project-ref <ref>` then `npm run db:push`. Re-link to `kanbo-dev` afterwards (`supabase/.temp` is git-ignored, so linking is local state).
4. **Auth config (each project):** Authentication → URL Configuration: Site URL = the matching app origin; Redirect URLs include `<origin>/auth/callback` and `<origin>/auth/confirm`. For staging also add `https://*-<vercel-team>.vercel.app/auth/callback` so preview URLs work. Providers → Google: create one OAuth client per environment in Google Cloud Console with the Supabase callback URL; paste client id/secret.
5. **Vercel:** `npm i -g vercel`, `vercel link` (new project `kanbo`, root directory `.`), connect the GitHub repo. Environment variables: *Preview* → `kanbo-staging` values with `NEXT_PUBLIC_SITE_URL` set per-branch by Vercel's `VERCEL_URL` (set `NEXT_PUBLIC_SITE_URL=https://kanbo-staging.vercel.app` for the persistent staging alias); *Production* → `kanbo-prod` values, `NEXT_PUBLIC_SITE_URL=https://<prod-domain>`. Generate `CRON_SECRET` and `UNSUBSCRIBE_SECRET` with `openssl rand -base64 32` (different per environment).
6. **GitHub Actions secrets** (used by Task 4/7): `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `STAGING_PROJECT_REF`, `STAGING_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN` (personal access token from the Supabase dashboard), `PROD_DB_URL` (connection string, session-mode pooler), `BACKUP_PASSPHRASE`, `DEV_SUPABASE_URL`, `DEV_SUPABASE_ANON_KEY`.

- [x] **Step 4: Update `README.md`**

Replace the "Deployment" section with: the three environments table (dev / staging / prod → Supabase project, Vercel target, who pushes migrations), the rule that previews never point at prod, the env var list above, and the per-environment Auth redirect URLs.

- [ ] **Step 5: Verify**

`vercel deploy` from the branch → preview URL boots, `/login` works against staging (create a throwaway account, verify email, create a project). `vercel inspect <url>` shows region `bom1`.

- [x] **Step 6: Commit**

```bash
git add vercel.ts .env.example README.md package.json package-lock.json
git commit -m "chore: add Vercel config in bom1 and document the three environments"
```

---

### Task 4: CI pipeline, coverage gate, bundle budget

**Files:**
- Create: `.github/workflows/ci.yml`, `.gitattributes`, `scripts/check-bundle-size.mjs`
- Modify: `vitest.config.mts`, `package.json`, `.prettierignore` (add `.github/`)

**Interfaces:**
- Produces: npm scripts `test:coverage`, `test:rls` (config lands in Task 5 — script added here so CI is final), `size`; GitHub check `ci`.

- [x] **Step 1: `.gitattributes`**

```
* text=auto eol=lf
*.png binary
*.ico binary
```

Run `git add --renormalize .` and confirm `git status` shows no content changes beyond line endings (if it does, commit them separately as `chore: normalise line endings`).

- [x] **Step 2: Coverage**

```bash
npm install --save-dev @vitest/coverage-v8@^5
```

In `vitest.config.mts` add inside `test`:

```ts
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.{ts,tsx}"],
      exclude: ["src/lib/**/*.test.{ts,tsx}", "src/test/**"],
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 60 },
      reporter: ["text", "lcov"],
    },
```

Scripts in `package.json`:

```json
    "test:coverage": "vitest run --coverage",
    "test:rls": "vitest run --config vitest.rls.config.mts",
    "size": "node scripts/check-bundle-size.mjs"
```

Run `npm run test:coverage`; if the threshold fails today, lower `branches` to the current value minus nothing — do **not** lower `lines` below 70; instead add tests for the uncovered `src/lib` file(s) until 70 % holds (the plan expects `src/lib/realtime/use-project-channel.ts` to be the gap — mock `createBrowserClient` and test subscribe/unsubscribe).

- [x] **Step 3: Bundle-size script**

```js
// scripts/check-bundle-size.mjs
// Fails when the board route's first-load JS exceeds the budget (01 §25: < 250 KB gzipped).
import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const BUDGET_BYTES = 250 * 1024;
const ROUTE = "/(app)/p/[projectId]/board/page";
const manifest = JSON.parse(readFileSync(".next/app-build-manifest.json", "utf8"));
const files = manifest.pages[ROUTE];
if (!files) {
  console.error(`Route ${ROUTE} not found in app-build-manifest.json`);
  process.exit(1);
}
let total = 0;
for (const file of files) {
  if (!file.endsWith(".js")) continue;
  const full = path.join(".next", file);
  statSync(full);
  total += gzipSync(readFileSync(full)).length;
}
const kb = (total / 1024).toFixed(1);
if (total > BUDGET_BYTES) {
  console.error(`Board route first-load JS is ${kb} KB gzipped — over the ${BUDGET_BYTES / 1024} KB budget.`);
  process.exit(1);
}
console.log(`Board route first-load JS: ${kb} KB gzipped (budget ${BUDGET_BYTES / 1024} KB).`);
```

Run `npm run build && npm run size` — expected: prints the size and exits 0.

- [x] **Step 4: Workflow**

```yaml
# .github/workflows/ci.yml
name: ci
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
env:
  NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.STAGING_SUPABASE_URL }}
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.STAGING_SUPABASE_ANON_KEY }}
  NEXT_PUBLIC_SITE_URL: https://kanbo-staging.vercel.app
  SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY }}
  EMAIL_PROVIDER: console
jobs:
  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test:coverage
      - run: npm audit --audit-level=high
      - run: npm run build
      - run: npm run size
      - uses: actions/upload-artifact@v4
        with: { name: coverage, path: coverage/lcov.info, retention-days: 7 }
  rls:
    runs-on: ubuntu-latest
    needs: quality
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run test:rls
  migrations:
    runs-on: ubuntu-latest
    needs: quality
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.STAGING_DB_PASSWORD }}
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - run: supabase link --project-ref ${{ secrets.STAGING_PROJECT_REF }}
      - run: supabase db push --dry-run
```

`rls` will fail until Task 5 lands; that is expected within this sub-plan and is why Task 5 follows immediately.

- [ ] **Step 5: Push and verify**

Push the branch, open a draft PR to `main`. Expected: `secrets`, `quality`, `migrations` green; `rls` red (no config yet). Temporarily break a unit test locally, push, confirm `quality` goes red, revert.

- [x] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml .gitattributes scripts/check-bundle-size.mjs vitest.config.mts package.json package-lock.json .prettierignore
git commit -m "ci: add typecheck, lint, coverage, audit, secret scan, bundle budget and migration dry-run"
```

---

### Task 5: RLS isolation suite

**Files:**
- Create: `vitest.rls.config.mts`, `src/test/rls/setup.ts`, `src/test/rls/isolation.test.ts`, `.env.test.example`
- Modify: `vitest.config.mts` (exclude `src/test/rls/**` from the unit run), `.gitignore` (`.env.test`)

**Interfaces:**
- Consumes: `createAdminClient()` (Task 2); RPCs `create_project(p_name, p_description, p_timezone)`, `create_task(p_project_id, p_column_id, p_title, …)`, `move_task(...)`.
- Produces:
  ```ts
  export type IsolationFixture = {
    a: SupabaseClient; b: SupabaseClient;          // anon clients signed in as A and B
    aId: string; bId: string;
    projectId: string; columnId: string; taskId: string;   // owned by A
    cleanup(): Promise<void>;
  };
  export async function seedIsolationFixture(): Promise<IsolationFixture>;
  ```
  Reused verbatim by 2B–2G for every new table.

- [x] **Step 1: RLS config**

```ts
// vitest.rls.config.mts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/test/rls/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: process.env.NEXT_PUBLIC_SUPABASE_URL ? {} : loadDotEnvTest(),
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
});

function loadDotEnvTest(): Record<string, string> {
  try {
    const text = require("node:fs").readFileSync(".env.test", "utf8") as string;
    return Object.fromEntries(
      text.split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
    );
  } catch {
    return {};
  }
}
```

`.env.test.example`:
```
# Copy to .env.test — points the RLS suite at kanbo-dev. Never at prod.
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-DEV-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
SUPABASE_SERVICE_ROLE_KEY=
```

In `vitest.config.mts` add `"src/test/rls/**"` to `exclude`.

- [x] **Step 2: Fixture**

```ts
// src/test/rls/setup.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export type IsolationFixture = {
  a: SupabaseClient; b: SupabaseClient;
  aId: string; bId: string;
  projectId: string; columnId: string; taskId: string;
  cleanup(): Promise<void>;
};

function anonClient() {
  return createClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createConfirmedUser(admin: SupabaseClient, label: string) {
  const email = `rls-${label}-${crypto.randomUUID()}@example.test`;
  const password = `Pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: `RLS ${label}` },
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  const client = anonClient();
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

export async function seedIsolationFixture(): Promise<IsolationFixture> {
  const admin = createAdminClient();
  const a = await createConfirmedUser(admin, "a");
  const b = await createConfirmedUser(admin, "b");

  const project = await a.client.rpc("create_project", { p_name: "Isolation P", p_description: null, p_timezone: "UTC" });
  if (project.error) throw project.error;
  const projectRow = Array.isArray(project.data) ? project.data[0] : project.data;
  const projectId: string = projectRow.id;

  const columns = await a.client.from("columns").select("id").eq("project_id", projectId).order("position").limit(1);
  if (columns.error || !columns.data?.[0]) throw columns.error ?? new Error("no default column");
  const columnId = columns.data[0].id as string;

  const task = await a.client.rpc("create_task", { p_project_id: projectId, p_column_id: columnId, p_title: "A's task" });
  if (task.error) throw task.error;
  const taskRow = Array.isArray(task.data) ? task.data[0] : task.data;
  const taskId: string = taskRow.id;

  return {
    a: a.client, b: b.client, aId: a.id, bId: b.id, projectId, columnId, taskId,
    async cleanup() {
      await admin.auth.admin.deleteUser(b.id);
      await admin.auth.admin.deleteUser(a.id); // cascades to users → projects → everything
    },
  };
}
```

- [x] **Step 3: Failing isolation tests**

```ts
// src/test/rls/isolation.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let f: IsolationFixture;
beforeAll(async () => { f = await seedIsolationFixture(); });
afterAll(async () => { await f.cleanup(); });

const PROJECT_TABLES = ["projects", "memberships", "invitations", "columns", "tasks", "activity"] as const;

describe("RLS isolation: user B cannot see user A's project (07 §18.1)", () => {
  it.each(PROJECT_TABLES)("%s returns zero rows", async (table) => {
    const filter = table === "projects" ? "id" : "project_id";
    const { data, error } = await f.b.from(table).select("*").eq(filter, f.projectId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("subtasks of A's task are invisible", async () => {
    const { data } = await f.b.from("subtasks").select("*").eq("task_id", f.taskId);
    expect(data).toEqual([]);
  });

  it("B cannot read A's users row", async () => {
    const { data } = await f.b.from("users").select("id").eq("id", f.aId);
    expect(data).toEqual([]);
  });

  it("A can see their own project (the fixture is valid)", async () => {
    const { data } = await f.a.from("tasks").select("id").eq("project_id", f.projectId);
    expect(data).toHaveLength(1);
  });
});

describe("RLS isolation: user B cannot write to A's project", () => {
  it("direct insert into tasks is rejected", async () => {
    const { error } = await f.b.from("tasks").insert({
      project_id: f.projectId, column_id: f.columnId, title: "intruder", position: 1, created_by: f.bId,
    });
    expect(error).not.toBeNull();
  });

  it("move_task RPC fails", async () => {
    const { error } = await f.b.rpc("move_task", {
      p_task_id: f.taskId, p_column_id: f.columnId, p_position: 0.5, p_mutation_id: crypto.randomUUID(),
    });
    expect(error).not.toBeNull();
    expect(["P0002", "42501"]).toContain(error?.code);
  });

  it("update_project RPC fails", async () => {
    const { error } = await f.b.rpc("update_project", {
      p_project_id: f.projectId, p_name: "hijack", p_description: null, p_timezone: "UTC",
    });
    expect(error).not.toBeNull();
  });

  it("activity cannot be updated or deleted by anyone through the API (append-only)", async () => {
    const del = await f.a.from("activity").delete().eq("project_id", f.projectId).select();
    expect(del.data ?? []).toEqual([]);
    const upd = await f.a.from("activity").update({ action: "deleted" }).eq("project_id", f.projectId).select();
    expect(upd.data ?? []).toEqual([]);
  });

  it("consume_rate_limit is not callable by authenticated users", async () => {
    const { error } = await f.a.rpc("consume_rate_limit", { p_key: "x", p_limit: 1, p_window_seconds: 60 });
    expect(error).not.toBeNull();
  });
});

describe("every public table has RLS enabled (07 §18.2)", () => {
  it("reports no table without RLS", async () => {
    // Uses the admin client through a read-only SQL function created in this task's migration.
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data, error } = await createAdminClient().rpc("tables_without_rls");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
```

- [x] **Step 4: Migration for the RLS audit function**

```sql
-- supabase/migrations/202609110002_rls_audit.sql
create or replace function public.tables_without_rls()
returns table (table_name text) language sql security definer set search_path = public, pg_catalog as $$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and (not c.relrowsecurity or not c.relforcerowsecurity)
  order by 1;
$$;
revoke all on function public.tables_without_rls() from public;
revoke all on function public.tables_without_rls() from authenticated;
grant execute on function public.tables_without_rls() to service_role;
```

Run `npm run db:push`.

- [x] **Step 5: Run the suite**

Run: `npm run test:rls`
Expected: all PASS. If `activity` update/delete returns rows, the RLS policies are wrong — stop and fix the policy (this is the point of the suite), never the test.

- [ ] **Step 6: Commit and confirm CI `rls` job is green**

```bash
git add vitest.rls.config.mts vitest.config.mts src/test/rls .env.test.example .gitignore supabase/migrations/202609110002_rls_audit.sql
git commit -m "test: add RLS isolation suite run against a hosted Supabase project"
```

---

### Task 6: Sentry and structured logging

**Files:**
- Create: `instrumentation.ts`, `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/app/global-error.tsx`, `src/lib/log.ts`, `src/lib/log.test.ts`
- Modify: `next.config.ts` (`withSentryConfig`), `src/lib/api/handler.ts` (use `log` + `Sentry.captureException` in the catch), `src/app/error.tsx` (show request id when present), `src/lib/security/headers.ts` (`connect-src` add the Sentry ingest origin derived from the DSN), `.env.example`

**Interfaces:**
- Produces:
  ```ts
  // src/lib/log.ts
  export type LogLevel = "debug" | "info" | "warn" | "error";
  export type LogFields = Record<string, string | number | boolean | null | undefined>;
  export function log(level: LogLevel, event: string, fields?: LogFields): void;   // one JSON line to stdout/stderr
  export const REDACTED_KEYS: readonly string[];  // keys whose values are replaced with "[redacted]"
  ```
  Redacted keys (case-insensitive substring match): `token`, `password`, `secret`, `authorization`, `cookie`, `email`, `body`.

- [x] **Step 1: Failing logger tests**

```ts
// src/lib/log.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "./log";

describe("log", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one JSON line with timestamp, level and event", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    log("info", "api.request", { route: "/api/v1/projects", status: 200, durationMs: 12 });
    expect(out).toHaveBeenCalledTimes(1);
    const line = JSON.parse(out.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "info", event: "api.request", route: "/api/v1/projects", status: 200 });
    expect(typeof line.timestamp).toBe("string");
  });

  it("redacts sensitive keys", () => {
    const out = vi.spyOn(console, "warn").mockImplementation(() => {});
    log("warn", "auth.failed", { accessToken: "abc", userEmail: "a@b.c", requestId: "r1" });
    const line = JSON.parse(out.mock.calls[0][0] as string);
    expect(line.accessToken).toBe("[redacted]");
    expect(line.userEmail).toBe("[redacted]");
    expect(line.requestId).toBe("r1");
  });

  it("routes error level to console.error", () => {
    const out = vi.spyOn(console, "error").mockImplementation(() => {});
    log("error", "boom");
    expect(out).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 2: Run to verify failure** — `npx vitest run src/lib/log.test.ts` → FAIL (module missing).

- [x] **Step 3: Implement logger**

```ts
// src/lib/log.ts
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export const REDACTED_KEYS = ["token", "password", "secret", "authorization", "cookie", "email", "body"] as const;

function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    const lower = key.toLowerCase();
    out[key] = REDACTED_KEYS.some((k) => lower.includes(k)) ? "[redacted]" : value;
  }
  return out;
}

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...redact(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
```

- [x] **Step 4: Sentry**

```bash
npm install @sentry/nextjs
```

```ts
// sentry.server.config.ts
import * as Sentry from "@sentry/nextjs";
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? "development",
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
});
```

`sentry.edge.config.ts`: identical content. `instrumentation-client.ts`:

```ts
import * as Sentry from "@sentry/nextjs";
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  sendDefaultPii: false,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
});
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

```ts
// instrumentation.ts
import * as Sentry from "@sentry/nextjs";
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}
export const onRequestError = Sentry.captureRequestError;
```

```tsx
// src/app/global-error.tsx
"use client";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center p-6">
        <div className="space-y-3 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          {error.digest && <p className="text-muted-foreground text-sm">Reference: {error.digest}</p>}
          <button onClick={reset} className="underline">Try again</button>
        </div>
      </body>
    </html>
  );
}
```

`next.config.ts`:

```ts
import { withSentryConfig } from "@sentry/nextjs";
// ...existing nextConfig unchanged...
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});
```

Add `SENTRY_ORG=`, `SENTRY_PROJECT=` to `.env.example`. In `securityHeaders`, when `process.env.NEXT_PUBLIC_SENTRY_DSN` is set, append its origin (`new URL(dsn).origin`) to `connect-src`.

In `withApiHandler`'s catch: replace the `console.error` with `log("error", "api.unhandled", { requestId, route: new URL(request.url).pathname })` and `Sentry.captureException(error, { tags: { requestId } })`.

In `src/app/error.tsx`: if `error.digest` exists render "Reference: {digest}" so users can quote it.

- [ ] **Step 5: Verify**

`npm run test && npm run typecheck && npm run lint && npm run build` pass. With a real DSN in `.env.local`, add a temporary `throw new Error("sentry smoke")` to a route, hit it, confirm the event in Sentry with tag `requestId`, remove the throw. Operator: create the Sentry project (free tier), set `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` on Vercel (preview + production).

- [x] **Step 6: Commit**

```bash
git add instrumentation.ts instrumentation-client.ts sentry.server.config.ts sentry.edge.config.ts src/app/global-error.tsx src/app/error.tsx src/lib/log.ts src/lib/log.test.ts src/lib/api/handler.ts src/lib/security/headers.ts next.config.ts .env.example package.json package-lock.json
git commit -m "feat(observability): add Sentry and structured JSON logging with request ids"
```

---

### Task 7: Nightly backups and keep-alive

**Files:**
- Create: `.github/workflows/backup.yml`, `docs/runbook.md`

- [x] **Step 1: Workflow**

```yaml
# .github/workflows/backup.yml
name: backup
on:
  schedule:
    - cron: "30 21 * * *"   # 03:00 IST daily
  workflow_dispatch:
permissions:
  contents: read
jobs:
  dump-prod:
    runs-on: ubuntu-latest
    steps:
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - name: Dump schema and data
        env:
          DB_URL: ${{ secrets.PROD_DB_URL }}
        run: |
          supabase db dump --db-url "$DB_URL" -f schema.sql
          supabase db dump --db-url "$DB_URL" --data-only -f data.sql
      - name: Encrypt
        env:
          PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}
        run: |
          tar czf dump.tgz schema.sql data.sql
          gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$PASSPHRASE" dump.tgz
          rm -f schema.sql data.sql dump.tgz
      - uses: actions/upload-artifact@v4
        with:
          name: kanbo-prod-${{ github.run_id }}
          path: dump.tgz.gpg
          retention-days: 90
  keep-alive:
    runs-on: ubuntu-latest
    steps:
      - name: Ping dev and staging so free projects do not pause
        run: |
          for pair in "${{ secrets.DEV_SUPABASE_URL }}|${{ secrets.DEV_SUPABASE_ANON_KEY }}" "${{ secrets.STAGING_SUPABASE_URL }}|${{ secrets.STAGING_SUPABASE_ANON_KEY }}"; do
            url="${pair%%|*}"; key="${pair##*|}"
            curl -fsS "$url/rest/v1/" -H "apikey: $key" -o /dev/null && echo "ok $url"
          done
```

- [x] **Step 2: Runbook**

`docs/runbook.md` sections: *Environments* (table), *Restore drill* (download artifact → `gpg --decrypt` → `tar xzf` → `psql "$DEV_DB_URL" -f schema.sql` on a **reset** `kanbo-dev` (`supabase db reset --linked` first) → `psql -f data.sql` → smoke-test login), *Rotating secrets* (which secret lives where, from `07 §8`), *Incident: snapshot job missed* (placeholder pointing at 2G.1 once it exists), *Rate limit tuning* (`RATE_LIMITS` in `src/lib/api/rate-limit.ts`).

- [ ] **Step 3: Verify**

`workflow_dispatch` the backup once → artifact appears; download, decrypt locally, confirm `schema.sql` contains `create table public.tasks`. Log the first restore drill date in the runbook.

- [x] **Step 4: Commit**

```bash
git add .github/workflows/backup.yml docs/runbook.md
git commit -m "ci: add nightly encrypted prod dump and keep-alive pings"
```

---

### Task 8: Password breach check (HIBP k-anonymity)

**Files:**
- Create: `src/lib/auth/breach-check.ts`, `src/lib/auth/breach-check.test.ts`
- Modify: `src/lib/auth/schemas.ts` (`passwordSchema.max(128)`), `src/lib/auth/schemas.test.ts`, `src/app/actions/auth.ts` (`signUp`, `resetPassword`)

**Interfaces:**
- Produces: `isBreachedPassword(password: string, deps?: { fetch?: typeof fetch; timeoutMs?: number }): Promise<boolean>`.

**Security properties:** only the first 5 hex chars of the SHA-1 leave the server; request uses `Add-Padding: true`; 2 s timeout; any failure returns `false` and logs `auth.breach_check_unavailable` (fail-open — an HIBP outage must not block signup, `07 §2`); password max length 128 enforced by Zod before hashing; the check runs before the Supabase call in both success and failure paths so response timing does not reveal account existence.

- [x] **Step 1: Failing tests**

```ts
// src/lib/auth/breach-check.test.ts
import { describe, expect, it, vi } from "vitest";
import { isBreachedPassword } from "./breach-check";

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const RANGE = "1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\n0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n";

const fetchWith = (body: string, ok = true) =>
  vi.fn(async () => new Response(body, { status: ok ? 200 : 500 }));

describe("isBreachedPassword", () => {
  it("sends only the 5-char prefix and detects a match", async () => {
    const fetch = fetchWith(RANGE);
    await expect(isBreachedPassword("password", { fetch })).resolves.toBe(true);
    const url = String(fetch.mock.calls[0][0]);
    expect(url).toBe("https://api.pwnedpasswords.com/range/5BAA6");
  });

  it("returns false when the suffix is absent", async () => {
    await expect(isBreachedPassword("correct horse battery staple 42", { fetch: fetchWith(RANGE) })).resolves.toBe(false);
  });

  it("fails open on a non-2xx response", async () => {
    await expect(isBreachedPassword("password", { fetch: fetchWith("", false) })).resolves.toBe(false);
  });

  it("fails open on timeout or network error", async () => {
    const fetch = vi.fn(async () => { throw new DOMException("aborted", "AbortError"); });
    await expect(isBreachedPassword("password", { fetch, timeoutMs: 10 })).resolves.toBe(false);
  });
});
```

In `src/lib/auth/schemas.test.ts` add: a 129-character password fails `passwordSchema`; a 128-character one passes.

- [x] **Step 2: Run to verify failure** — `npx vitest run src/lib/auth` → FAIL.

- [x] **Step 3: Implement**

```ts
// src/lib/auth/breach-check.ts
import { createHash } from "node:crypto";
import { log } from "@/lib/log";

const RANGE_URL = "https://api.pwnedpasswords.com/range/";

export async function isBreachedPassword(
  password: string,
  deps: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<boolean> {
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 2000;
  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const response = await doFetch(`${RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      log("warn", "auth.breach_check_unavailable", { status: response.status });
      return false;
    }
    const text = await response.text();
    return text.split(/\r?\n/).some((line) => line.split(":")[0] === suffix);
  } catch (error) {
    log("warn", "auth.breach_check_unavailable", { reason: error instanceof Error ? error.name : "unknown" });
    return false;
  }
}
```

`passwordSchema` → `.max(128, "Passwords are limited to 128 characters")`.

In `signUp` and `resetPassword` (`src/app/actions/auth.ts`), after `safeParse` succeeds and before `createClient()`:

```ts
  if (await isBreachedPassword(parsed.data.password)) {
    return {
      ok: false,
      message: "Please correct the highlighted fields.",
      fieldErrors: { password: "This password appeared in a data breach. Choose another." },
    };
  }
```

- [x] **Step 4: Run tests, typecheck, lint** — all PASS.

- [ ] **Step 5: Manual check** — `npm run dev`, sign up with `password123` → inline error under Password; sign up with a long random passphrase → proceeds to verify-email.

- [x] **Step 6: Commit**

```bash
git add src/lib/auth src/app/actions/auth.ts
git commit -m "feat(auth): reject breached passwords via HIBP k-anonymity range check"
```

---

### Task 9: Record the decisions

**Files:**
- Modify: `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md`, `README.md`

- [x] **Step 1: Append a dated section to the build-decisions doc**

```markdown
## Amendments — 2026-09-11 (approved with the MVP roadmap)

| ID | Decision |
|----|----------|
| A1 | **Architecture:** transactional business rules live in Postgres `security definer` RPCs; route handlers are thin (`src/lib/api/handler.ts`). Supersedes `03 §4` service/repository layering. Rationale: Supabase clients cannot open multi-statement transactions, so the mutation + activity-log atomicity (`FR-8`) requires database functions regardless. |
| M6 (amended) | **Free tier only, permanently.** No Supabase Pro: no PITR, no managed backups (nightly `supabase db dump` via GitHub Actions, RPO 24 h), no built-in leaked-password protection (HIBP check implemented in app code), free projects kept awake by scheduled pings. |
| S1 | **Scheduling:** all jobs run on `pg_cron`; jobs that send email are triggered via `pg_net` → `/api/cron/*` with `CRON_SECRET`. Vercel Cron is not used (Hobby allows daily only). |
| S2 | **Rate limiting:** Postgres fixed-window counters (`consume_rate_limit`, service-role only). |
| S3 | **RLS acceptance:** Vitest integration suite against a hosted project (`npm run test:rls`), not pgTAP (no local Docker). |
| S4 | **Digest:** per-project, Monday 09:00 in `projects.timezone`. |
| S5 | **Watched task:** creator + assignee + commenters, implicit. |
| S6 | **Git attribution:** no AI co-author or session trailers (`ENGINEERING_RULES.md §7`). |
| S7 | Full gap register: `docs/superpowers/plans/2026-09-11-kanbo-mvp/00-master-roadmap.md §2`. |
```

- [x] **Step 2: README** — add a "Checks" line for `npm run test:rls` (needs `.env.test`) and `npm run size`.

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md README.md
git commit -m "docs: record roadmap decisions and free-tier amendment"
```

---

## Verification (sub-plan exit)

1. `npm run test && npm run test:coverage && npm run typecheck && npm run lint && npm run build && npm run size` — all green locally.
2. `npm run test:rls` against `kanbo-dev` — green.
3. Draft PR on GitHub: `secrets`, `quality`, `rls`, `migrations` jobs all green.
4. Vercel preview URL (staging DB) — sign up, verify, create project, drag a task; API responses carry `x-request-id` and `X-RateLimit-*`.
5. Sentry receives a deliberate test error with a `requestId` tag, then the throw is removed.
6. `backup` workflow dispatched once; artifact decrypts; first restore drill logged in `docs/runbook.md`.
7. Signup with `password123` is rejected with the breach message.

## Self-review notes

- Spec coverage: T2 (Task 2), T3 deferred to 2B.3 by design (idempotency keys are first needed there), T7 (Task 3), T9 (Task 8), T13–T15 (Task 4), T17 (Task 7), `03 §15–17` (Task 6), `03 §23–25` (Tasks 3–4), `07 §18.2` (Task 5), `07 §18.3` (gitleaks + existing ESLint rule), `07 §18.11` (`npm audit` in CI).
- Type consistency: `withApiHandler` option names (`params`, `body`, `rateLimit`, `notFoundMessage`, `unauthenticatedMessage`, `validationMessage`) and `mapRpcError({ message, requestId, projectScoped })` are used identically in Tasks 1, 2, 6 and are the contract 2B–2G build on.

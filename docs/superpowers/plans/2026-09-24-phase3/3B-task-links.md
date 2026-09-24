# 3B Task Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let members attach named http(s) links to a task: a Links section in the task drawer and a link-count chip on board cards and list rows. This replaces file attachments for now.

**Architecture:** A `task_links` table that is read through RLS, plus two `security definer` RPCs (`add_task_link`, `delete_task_link`) that enforce role, URL scheme, the 50-per-task cap, and write activity entries. Thin routes follow the subtasks pattern. A self-contained `TaskLinks` drawer section is added next to `SubtaskList`. No URL is ever fetched server-side.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (plpgsql, PostgREST), zod 3, Vitest + Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-24-calendar-links-dependencies-design.md` (section "3B Task links").

**Depends on:** 3A is merged into this branch first. This plan touches the same board/list query strings and `TaskCard` row that 3A Task 6 changed.

## Global Constraints

- Business logic lives in plpgsql RPCs. Routes use `withApiHandler`, `mapRpcError`, `firstRow` and `json` from `src/lib/api/handler.ts`.
- No new npm dependencies.
- The URL must match `^https?://` (case-insensitive), contain no whitespace, and be at most 2048 characters. The title is optional and at most 200 characters; a blank title is stored as `null` and the UI shows the hostname instead. There are at most 50 links per task.
- Adding requires `can_write_project`. Deleting is allowed for the link's creator, or an owner or admin, and still requires `can_write_project`. Viewers can read only.
- Activity actions are `link_added` and `link_removed`, with `entity_type` `'task_link'`. The new enum values ship in their own migration, because PostgreSQL forbids using an enum value in the transaction that adds it (see `202609210001_activity_action_commented.sql`).
- Links render as `<a target="_blank" rel="noopener noreferrer">`. There is no server-side fetching or unfurling.
- Migrations are numbered `202610030001` and `202610030002`. Apply them with `npx supabase db push`. The user approved this for additive migrations; never use `db reset`.
- Commits carry **no** `Co-Authored-By` or `Claude-Session` trailers.
- Test fixture status (observation 0008): none of the expected values in this plan were executed by the plan author. If a test fails and the implementation matches the plan, suspect the fixture, fix it minimally, and report it.

## Review Focus

1. **`javascript:`, `data:` and `ftp:` URLs,** and URLs that contain spaces, are rejected by both the API schema and the RPC, so a crafted request cannot store one. Covered by the Task 1 RLS test and the Task 2 schema test.
2. **A URL typed without a scheme** (`example.com/doc`) gets a clear inline error, not a silent failure or a relative link. Covered by the Task 3 component test.
3. **A member deleting someone else's link** is refused, while an owner or admin may delete any link. Covered by the Task 1 RLS test, and the delete button is hidden in the UI (Task 3 test).
4. **The 51st link on a task** is refused with a validation error, even under concurrent adds, because the parent task row is locked. The Task 1 RLS test covers the cap.
5. **A very long title or URL** must not break the drawer layout. Titles and hostnames truncate (`min-w-0 truncate`), checked visually in Task 3's manual step.

---

### Task 1: `task_links` schema and RPCs

**Files:**
- Create: `supabase/migrations/202610030001_activity_action_links.sql`
- Create: `supabase/migrations/202610030002_task_links.sql`
- Test: `src/test/rls/task-links.test.ts`

**Interfaces:**
- Produces the table `public.task_links(id, project_id, task_id, url, title, created_by, created_at)`.
- Produces the RPC `add_task_link(p_task_id uuid, p_url text, p_title text)`, which returns `(id, task_id, url, title, created_by, created_at)`.
- Produces the RPC `delete_task_link(p_task_id uuid, p_link_id uuid) returns void`.

- [ ] **Step 1: Write the failing RLS test**

Create `src/test/rls/task-links.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let fixture: IsolationFixture;
beforeAll(async () => {
  fixture = await seedIsolationFixture();
});
afterAll(async () => {
  await fixture?.cleanup();
});

function row<T>(data: T | T[] | null): T {
  return (Array.isArray(data) ? data[0] : data) as T;
}

describe("task links", () => {
  it("lets members add links and hides them from non-members", async () => {
    const added = await fixture.a.rpc("add_task_link", {
      p_task_id: fixture.taskId,
      p_url: "https://example.com/spec",
      p_title: "  ",
    });
    expect(added.error).toBeNull();
    expect(row(added.data)).toMatchObject({ url: "https://example.com/spec", title: null });

    const read = await fixture.b.from("task_links").select("id").eq("task_id", fixture.taskId);
    expect(read.data).toEqual([]);
    const denied = await fixture.b.rpc("add_task_link", {
      p_task_id: fixture.taskId,
      p_url: "https://example.com/other",
      p_title: null,
    });
    expect(denied.error?.code).toBe("P0002");
  });

  it("rejects non-http schemes, whitespace and over-long URLs", async () => {
    for (const url of [
      "javascript:alert(1)",
      "ftp://example.com/file",
      "https://example.com/has space",
      `https://example.com/${"a".repeat(2048)}`,
    ]) {
      const result = await fixture.a.rpc("add_task_link", {
        p_task_id: fixture.taskId,
        p_url: url,
        p_title: null,
      });
      expect(result.error?.code, url).toBe("22023");
    }
  });

  it("enforces viewer, creator and admin rules and records activity", async () => {
    const admin = createAdminClient();
    await admin
      .from("memberships")
      .insert({ project_id: fixture.projectId, user_id: fixture.bId, role: "viewer" });
    const viewer = await fixture.b.rpc("add_task_link", {
      p_task_id: fixture.taskId,
      p_url: "https://example.com/viewer",
      p_title: null,
    });
    expect(viewer.error?.code).toBe("42501");

    await admin
      .from("memberships")
      .update({ role: "member" })
      .eq("project_id", fixture.projectId)
      .eq("user_id", fixture.bId);
    const byB = await fixture.b.rpc("add_task_link", {
      p_task_id: fixture.taskId,
      p_url: "https://example.com/b",
      p_title: "B's doc",
    });
    expect(byB.error).toBeNull();

    const ownerLink = await fixture.a
      .from("task_links")
      .select("id")
      .eq("task_id", fixture.taskId)
      .eq("url", "https://example.com/spec")
      .single();
    const notCreator = await fixture.b.rpc("delete_task_link", {
      p_task_id: fixture.taskId,
      p_link_id: ownerLink.data!.id,
    });
    expect(notCreator.error?.code).toBe("42501");

    const ownerDeletes = await fixture.a.rpc("delete_task_link", {
      p_task_id: fixture.taskId,
      p_link_id: row<{ id: string }>(byB.data).id,
    });
    expect(ownerDeletes.error).toBeNull();

    const activity = await fixture.a
      .from("activity")
      .select("action")
      .eq("task_id", fixture.taskId)
      .in("action", ["link_added", "link_removed"]);
    expect(activity.data?.map((entry) => entry.action).sort()).toEqual([
      "link_added",
      "link_added",
      "link_removed",
    ]);
  });

  it("caps a task at 50 links", async () => {
    const admin = createAdminClient();
    await admin.from("task_links").delete().eq("task_id", fixture.taskId);
    const seeded = await admin.from("task_links").insert(
      Array.from({ length: 50 }, (_, index) => ({
        project_id: fixture.projectId,
        task_id: fixture.taskId,
        url: `https://example.com/${index}`,
        created_by: fixture.aId,
      })),
    );
    expect(seeded.error).toBeNull();
    const overCap = await fixture.a.rpc("add_task_link", {
      p_task_id: fixture.taskId,
      p_url: "https://example.com/51",
      p_title: null,
    });
    expect(overCap.error?.code).toBe("22023");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:rls -- src/test/rls/task-links.test.ts`
Expected: FAIL. `add_task_link` is not found (`PGRST202`), and the `task_links` table does not exist.

- [ ] **Step 3: Write the migrations**

Create `supabase/migrations/202610030001_activity_action_links.sql`:

```sql
-- Kept separate from the RPC migration: PostgreSQL forbids using a freshly
-- added enum value in the same transaction that adds it.
alter type public.activity_action add value if not exists 'link_added';
alter type public.activity_action add value if not exists 'link_removed';
```

Create `supabase/migrations/202610030002_task_links.sql`:

```sql
-- Named http(s) links on a task (spec 3B). Reads go through RLS; writes only
-- through the RPCs below. URLs are never fetched server-side.
create table public.task_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  url varchar(2048) not null check (url ~* '^https?://[^[:space:]]+$'),
  title varchar(200) check (title is null or char_length(trim(title)) between 1 and 200),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_task_links_task on public.task_links(task_id, created_at);
alter table public.task_links enable row level security;
alter table public.task_links force row level security;
create policy task_links_member_read on public.task_links for select using (
  exists (
    select 1 from public.tasks t
    where t.id = task_links.task_id and t.deleted_at is null and public.is_project_member(t.project_id)
  )
);

create or replace function public.add_task_link(p_task_id uuid, p_url text, p_title text)
returns table (id uuid, task_id uuid, url varchar, title varchar, created_by uuid, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  parent_task public.tasks%rowtype;
  link_row public.task_links%rowtype;
  clean_url text := trim(p_url);
  clean_title text := nullif(trim(p_title), '');
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into parent_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null for update;
  if not found or not public.is_project_member(parent_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(parent_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if clean_url is null or char_length(clean_url) > 2048 or clean_url !~* '^https?://[^[:space:]]+$' then
    raise exception 'INVALID_LINK_URL' using errcode = '22023';
  end if;
  if clean_title is not null and char_length(clean_title) > 200 then raise exception 'INVALID_LINK_TITLE' using errcode = '22023'; end if;
  if (select count(*) from public.task_links where task_links.task_id = parent_task.id) >= 50 then
    raise exception 'LINK_LIMIT' using errcode = '22023';
  end if;
  insert into public.task_links (project_id, task_id, url, title, created_by)
  values (parent_task.project_id, parent_task.id, clean_url, clean_title, current_user_id)
  returning * into link_row;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, to_value)
  values (parent_task.project_id, current_user_id, parent_task.id, 'task_link', link_row.id, 'link_added',
    jsonb_build_object('url', link_row.url, 'title', link_row.title));
  return query select link_row.id, link_row.task_id, link_row.url, link_row.title, link_row.created_by, link_row.created_at;
end;
$$;

create or replace function public.delete_task_link(p_task_id uuid, p_link_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  link_row public.task_links%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select l.* into link_row from public.task_links l
  join public.tasks t on t.id = l.task_id and t.deleted_at is null
  where l.id = p_link_id and l.task_id = p_task_id
  for update of l;
  if not found or not public.is_project_member(link_row.project_id) then raise exception 'LINK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(link_row.project_id) or (
    link_row.created_by is distinct from current_user_id and not exists (
      select 1 from public.memberships m
      where m.project_id = link_row.project_id and m.user_id = current_user_id and m.role in ('owner', 'admin')
    )
  ) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.task_links where task_links.id = link_row.id;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value)
  values (link_row.project_id, current_user_id, link_row.task_id, 'task_link', link_row.id, 'link_removed',
    jsonb_build_object('url', link_row.url, 'title', link_row.title));
end;
$$;

revoke all on function public.add_task_link(uuid, text, text) from public, anon;
revoke all on function public.delete_task_link(uuid, uuid) from public, anon;
grant execute on function public.add_task_link(uuid, text, text) to authenticated;
grant execute on function public.delete_task_link(uuid, uuid) to authenticated;
```

- [ ] **Step 4: Apply and run**

Run: `npx supabase db push` (confirm the two migrations), then `npm run test:rls -- src/test/rls/task-links.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202610030001_activity_action_links.sql supabase/migrations/202610030002_task_links.sql src/test/rls/task-links.test.ts
git commit -m "feat(links): add task_links table with add and delete RPCs"
```

---

### Task 2: Link schema and routes

**Files:**
- Create: `src/lib/links/schemas.ts`
- Create: `src/lib/links/schemas.test.ts`
- Create: `src/app/api/v1/tasks/[taskId]/links/route.ts`
- Create: `src/app/api/v1/tasks/[taskId]/links/[linkId]/route.ts`

**Interfaces:**
- Produces `createTaskLinkSchema` (`{ url: string; title?: string | null }`), `type TaskLink = { id; task_id; url; title: string | null; created_by: string | null; created_at }` and `linkHostname(url): string`, all in `src/lib/links/schemas.ts`.
- Produces the routes `GET /api/v1/tasks/[taskId]/links` → `{ data: TaskLink[] }`, `POST` → 201 `{ data: TaskLink }`, and `DELETE /api/v1/tasks/[taskId]/links/[linkId]` → 204.

- [ ] **Step 1: Write the failing test**

Create `src/lib/links/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTaskLinkSchema, linkHostname } from "./schemas";

describe("createTaskLinkSchema", () => {
  it("accepts http and https links and trims the title", () => {
    expect(
      createTaskLinkSchema.parse({ url: " https://example.com/a ", title: "  Spec " }),
    ).toEqual({ url: "https://example.com/a", title: "Spec" });
    expect(createTaskLinkSchema.parse({ url: "HTTP://example.com" }).url).toBe("HTTP://example.com");
  });

  it("rejects other schemes, bare hosts and whitespace", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "ftp://example.com",
      "example.com/doc",
      "https://example.com/a b",
    ]) {
      expect(createTaskLinkSchema.safeParse({ url }).success, url).toBe(false);
    }
  });

  it("limits URL and title length", () => {
    expect(
      createTaskLinkSchema.safeParse({ url: `https://example.com/${"a".repeat(2048)}` }).success,
    ).toBe(false);
    expect(
      createTaskLinkSchema.safeParse({ url: "https://example.com", title: "t".repeat(201) })
        .success,
    ).toBe(false);
  });
});

describe("linkHostname", () => {
  it("returns the hostname, or the raw value if it cannot be parsed", () => {
    expect(linkHostname("https://docs.example.com/a?b=1")).toBe("docs.example.com");
    expect(linkHostname("not a url")).toBe("not a url");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/links/schemas.test.ts`
Expected: FAIL with "Failed to resolve import ./schemas".

- [ ] **Step 3: Write the schema and routes**

Create `src/lib/links/schemas.ts`:

```ts
import { z } from "zod";

const HTTP_URL = /^https?:\/\/\S+$/i;

export const createTaskLinkSchema = z.object({
  url: z
    .string()
    .trim()
    .max(2048, "Links are limited to 2048 characters")
    .regex(HTTP_URL, "Use a full link starting with http:// or https://"),
  title: z
    .string()
    .trim()
    .max(200, "Link titles are limited to 200 characters")
    .nullable()
    .optional(),
});

export type CreateTaskLinkInput = z.infer<typeof createTaskLinkSchema>;

export type TaskLink = {
  id: string;
  task_id: string;
  url: string;
  title: string | null;
  created_by: string | null;
  created_at: string;
};

export function linkHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
```

Create `src/app/api/v1/tasks/[taskId]/links/route.ts`:

```ts
import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { createTaskLinkSchema } from "@/lib/links/schemas";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.reads,
    params: z.object({ taskId: z.string().uuid() }),
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to view links.",
  },
  async ({ supabase, params }) => {
    const { data, error } = await supabase
      .from("task_links")
      .select("id, task_id, url, title, created_by, created_at")
      .eq("task_id", params.taskId)
      .order("created_at");
    if (error) return apiError(404, "NOT_FOUND", "Task not found.");
    return json({ data: data ?? [] });
  },
);

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid() }),
    body: createTaskLinkSchema,
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to add links.",
    validationMessage: "Use a full link starting with http:// or https://.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("add_task_link", {
      p_task_id: params.taskId,
      p_url: body.url,
      p_title: body.title ?? null,
    });
    if (error)
      return mapRpcError(error, {
        message:
          error.code === "22023"
            ? "That link could not be added. Check it, or remove an old link if this task has 50."
            : "Link could not be added.",
        requestId,
        projectScoped: true,
      });
    const link = firstRow(data);
    if (!link)
      return apiError(500, "INTERNAL_ERROR", "Link creation returned no link.", { requestId });
    return json({ data: link }, { status: 201 });
  },
);
```

Create `src/app/api/v1/tasks/[taskId]/links/[linkId]/route.ts`:

```ts
import { z } from "zod";
import { mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid(), linkId: z.string().uuid() }),
    notFoundMessage: "Link not found.",
    unauthenticatedMessage: "Sign in to remove links.",
  },
  async ({ supabase, params, requestId }) => {
    const { error } = await supabase.rpc("delete_task_link", {
      p_task_id: params.taskId,
      p_link_id: params.linkId,
    });
    if (error) return mapRpcError(error, { message: "Link could not be removed.", requestId });
    return new Response(null, { status: 204 });
  },
);
```

`DELETE` deliberately leaves out `projectScoped`, so a member who is not the creator gets 403 and the UI can explain it. Non-members still get 404 from `P0002`.

- [ ] **Step 4: Run the tests and checks**

Run: `npx vitest run src/lib/links/schemas.test.ts`, then `npm run typecheck`, then `npm run lint`
Expected: 4 passed. Typecheck and lint are clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/links/schemas.ts src/lib/links/schemas.test.ts "src/app/api/v1/tasks/[taskId]/links/route.ts" "src/app/api/v1/tasks/[taskId]/links/[linkId]/route.ts"
git commit -m "feat(links): add task link schema and routes"
```

---

### Task 3: Links section in the task drawer

**Files:**
- Create: `src/components/board/task-links.tsx`
- Create: `src/components/board/task-links.test.tsx`
- Modify: `src/components/board/task-detail-drawer.tsx` (props, and render `TaskLinks` after `SubtaskList`)
- Modify: `src/components/board/task-detail-drawer.test.tsx` (mock `./task-links`)

**Interfaces:**
- Consumes: the Task 2 routes, and `createTaskLinkSchema`, `linkHostname` and `TaskLink` from `@/lib/links/schemas`.
- Produces `TaskLinks({ taskId, currentUserId, currentUserRole, readOnly, onCountChange? })`, and a new optional prop on `TaskDetailDrawer`: `onLinkCountChange?: (count: number) => void`.

- [ ] **Step 1: Write the failing test**

Create `src/components/board/task-links.test.tsx`:

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TaskLinks } from "./task-links";

afterEach(() => vi.unstubAllGlobals());

const mine = {
  id: "l1",
  task_id: "t1",
  url: "https://docs.example.com/spec",
  title: null,
  created_by: "u1",
  created_at: "2026-09-01T00:00:00Z",
};
const theirs = { ...mine, id: "l2", url: "https://figma.com/file/1", title: "Mockups", created_by: "u2" };
const props = {
  taskId: "t1",
  currentUserId: "u1",
  currentUserRole: "member" as const,
  readOnly: false,
};

it("opens links in a new tab and falls back to the hostname", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [mine, theirs] }) }),
  );
  render(<TaskLinks {...props} />);
  const fallback = await screen.findByRole("link", { name: /docs\.example\.com/ });
  expect(fallback).toHaveAttribute("href", "https://docs.example.com/spec");
  expect(fallback).toHaveAttribute("target", "_blank");
  expect(fallback).toHaveAttribute("rel", "noopener noreferrer");
  expect(screen.getByRole("link", { name: /Mockups/ })).toBeInTheDocument();
});

it("lets members remove only their own links", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [mine, theirs] }) }),
  );
  render(<TaskLinks {...props} />);
  await screen.findByRole("link", { name: /Mockups/ });
  expect(screen.getByRole("button", { name: "Remove docs.example.com" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove Mockups" })).toBeNull();
});

it("rejects a link without a scheme before sending it", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<TaskLinks {...props} />);
  await userEvent.type(await screen.findByLabelText("Link URL"), "example.com/doc");
  await userEvent.click(screen.getByRole("button", { name: "Add link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/http:\/\/ or https:\/\//);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("adds a link and reports the new count", async () => {
  const onCountChange = vi.fn();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [mine] }) })
    .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: theirs }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<TaskLinks {...props} onCountChange={onCountChange} />);
  await userEvent.type(await screen.findByLabelText("Link URL"), "https://figma.com/file/1");
  await userEvent.type(screen.getByLabelText("Link title (optional)"), "Mockups");
  await userEvent.click(screen.getByRole("button", { name: "Add link" }));
  await screen.findByRole("link", { name: /Mockups/ });
  expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({
    url: "https://figma.com/file/1",
    title: "Mockups",
  });
  await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(2));
});

it("shows links read-only to viewers", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [mine] }) }),
  );
  render(<TaskLinks {...props} currentUserRole="viewer" readOnly />);
  const list = await screen.findByRole("list", { name: "Links" });
  expect(within(list).getAllByRole("link")).toHaveLength(1);
  expect(screen.queryByLabelText("Link URL")).toBeNull();
  expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/board/task-links.test.tsx`
Expected: FAIL with "Failed to resolve import ./task-links".

- [ ] **Step 3: Write the component**

Create `src/components/board/task-links.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Link2, LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createTaskLinkSchema, linkHostname, type TaskLink } from "@/lib/links/schemas";

export function TaskLinks({
  taskId,
  currentUserId,
  currentUserRole,
  readOnly,
  onCountChange,
}: {
  taskId: string;
  currentUserId: string;
  currentUserRole: "owner" | "admin" | "member" | "viewer";
  readOnly: boolean;
  onCountChange?: (count: number) => void;
}) {
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/tasks/${taskId}/links`)
      .then(async (response) => {
        const payload = (await response.json()) as { data?: unknown };
        if (!response.ok || !Array.isArray(payload.data)) throw new Error("Load rejected");
        if (active) setLinks(payload.data as TaskLink[]);
      })
      .catch(() => active && setError("Links could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [taskId]);

  function commit(next: TaskLink[]) {
    setLinks(next);
    onCountChange?.(next.length);
  }

  async function addLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createTaskLinkSchema.safeParse({ url, title: title.trim() || null });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the link and try again.");
      return;
    }
    setError(null);
    setPendingId("new");
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const payload = (await response.json()) as {
        data?: TaskLink;
        error?: { message?: string };
      };
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message ?? "Link could not be added. Try again.");
      commit([...links, payload.data]);
      setUrl("");
      setTitle("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Link could not be added. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  async function removeLink(link: TaskLink) {
    setError(null);
    setPendingId(link.id);
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/links/${link.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Delete rejected");
      commit(links.filter((item) => item.id !== link.id));
    } catch {
      setError("Link could not be removed. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  const canManageAll = currentUserRole === "owner" || currentUserRole === "admin";
  return (
    <section className="space-y-3 border-t pt-5" aria-labelledby="links-title">
      <h3 id="links-title" className="font-medium">
        Links
      </h3>
      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" /> Loading links
        </div>
      ) : (
        <ul aria-label="Links" className="space-y-1.5">
          {links.map((link) => {
            const label = link.title ?? linkHostname(link.url);
            const canRemove = !readOnly && (canManageAll || link.created_by === currentUserId);
            return (
              <li
                key={link.id}
                className="hover:bg-muted/60 flex items-center gap-2 rounded-md px-1 py-1.5"
              >
                <Link2 className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-visible:ring-ring min-w-0 flex-1 rounded text-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="block truncate font-medium">{label}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {linkHostname(link.url)}
                  </span>
                </a>
                {canRemove && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${label}`}
                    disabled={pendingId === link.id}
                    onClick={() => void removeLink(link)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!loading && links.length === 0 && (
        <p className="text-muted-foreground text-sm">Add links to docs, designs or tickets.</p>
      )}
      {!readOnly && (
        <form className="grid gap-2 sm:grid-cols-[1fr_12rem_auto]" onSubmit={(e) => void addLink(e)}>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            type="text"
            inputMode="url"
            maxLength={2048}
            placeholder="https://"
            aria-label="Link URL"
            className="bg-background placeholder:text-muted-foreground focus-visible:ring-ring/40 h-9 min-w-0 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
          />
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            placeholder="Title (optional)"
            aria-label="Link title (optional)"
            className="bg-background placeholder:text-muted-foreground focus-visible:ring-ring/40 h-9 min-w-0 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
          />
          <Button type="submit" size="sm" disabled={!url.trim() || pendingId === "new"}>
            {pendingId === "new" ? "Adding" : "Add link"}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
```

The URL input is `type="text"` with `inputMode="url"`, not `type="url"`. That way the browser's own validation doesn't block submit, and the schema's clearer message shows instead.

- [ ] **Step 4: Wire it into the drawer**

In `src/components/board/task-detail-drawer.tsx`:
1. `import { TaskLinks } from "./task-links";`
2. Add `onLinkCountChange?: (count: number) => void;` to the props type, and `onLinkCountChange` to the destructured parameters.
3. Directly after the `<SubtaskList … />` element, add:

```tsx
          <TaskLinks
            taskId={task.id}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            readOnly={readOnly}
            onCountChange={onLinkCountChange}
          />
```

In `src/components/board/task-detail-drawer.test.tsx`, add this under the existing `vi.mock` calls, so the ordered fetch mocks in the existing tests stay valid:

```tsx
vi.mock("./task-links", () => ({ TaskLinks: () => null }));
```

- [ ] **Step 5: Run the tests and checks**

Run: `npx vitest run src/components/board`, then `npm run typecheck`, then `npm run lint`
Expected: all board tests pass, including the 5 new ones. Typecheck and lint are clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/board/task-links.tsx src/components/board/task-links.test.tsx src/components/board/task-detail-drawer.tsx src/components/board/task-detail-drawer.test.tsx
git commit -m "feat(links): add Links section to the task drawer"
```

---

### Task 4: Link-count chip on cards and rows

**Files:**
- Create: `src/lib/tasks/embedded-count.ts`
- Create: `src/lib/tasks/embedded-count.test.ts`
- Create: `src/components/tasks/link-count.tsx`
- Create: `src/components/tasks/link-count.test.tsx`
- Modify: `src/app/(app)/p/[projectId]/board/page.tsx`, `src/app/(app)/p/[projectId]/list/page.tsx` (task select and mapping)
- Modify: `src/components/board/project-board.tsx` (`BoardTask`, `TaskCard`, `TaskDetailDrawer` props)
- Modify: `src/components/list/task-table.tsx`, `src/components/list/project-task-list.tsx`

**Interfaces:**
- Produces:
  - `embeddedCount(value: { count: number }[] | null | undefined): number`. PostgREST returns an embedded `task_links(count)` as `[{ count: n }]`.
  - `LinkCount({ count })`.
  - `BoardTask` gains `link_count?: number`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/tasks/embedded-count.test.ts`:

```ts
import { expect, it } from "vitest";
import { embeddedCount } from "./embedded-count";

it("reads a PostgREST embedded count", () => {
  expect(embeddedCount([{ count: 3 }])).toBe(3);
  expect(embeddedCount([])).toBe(0);
  expect(embeddedCount(null)).toBe(0);
});
```

Create `src/components/tasks/link-count.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { LinkCount } from "./link-count";

it("shows the count with an accessible description", () => {
  render(<LinkCount count={2} />);
  expect(screen.getByText("2 links")).toBeInTheDocument();
});

it("uses the singular and hides at zero", () => {
  const { rerender, container } = render(<LinkCount count={1} />);
  expect(screen.getByText("1 link")).toBeInTheDocument();
  rerender(<LinkCount count={0} />);
  expect(container).toBeEmptyDOMElement();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/tasks/embedded-count.test.ts src/components/tasks/link-count.test.tsx`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Write the helper and chip**

Create `src/lib/tasks/embedded-count.ts`:

```ts
export function embeddedCount(value: { count: number }[] | null | undefined): number {
  return value?.[0]?.count ?? 0;
}
```

Create `src/components/tasks/link-count.tsx`:

```tsx
import { Link2 } from "lucide-react";

export function LinkCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <Link2 className="size-3" aria-hidden="true" />
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">
        {count} {count === 1 ? "link" : "links"}
      </span>
    </span>
  );
}
```

- [ ] **Step 4: Load and render counts**

In both page files, append `, task_links(count)` to the tasks select string (after `subtasks(is_completed)` from 3A). Add `import { embeddedCount } from "@/lib/tasks/embedded-count";`. In each mapping, destructure `task_links` alongside `subtasks` and add `link_count: embeddedCount(task_links),`. For the board page:

```tsx
  const tasks = (taskData ?? []).map(({ subtasks, task_links, ...task }) => ({
    ...task,
    ...subtaskCounts(subtasks),
    link_count: embeddedCount(task_links),
    labels: (task.task_labels ?? []).flatMap((taskLabel) => {
      const label = Array.isArray(taskLabel.labels) ? taskLabel.labels[0] : taskLabel.labels;
      return label ? [{ id: label.id, name: label.name, color: label.color }] : [];
    }),
  })) as BoardTask[];
```

In `project-board.tsx`:
- Add `link_count?: number;` to `BoardTask`, and `import { LinkCount } from "@/components/tasks/link-count";`.
- In `TaskCard`, directly after `<SubtaskProgress … />`, add `<LinkCount count={task.link_count ?? 0} />`.
- On `TaskDetailDrawer`, add:

```tsx
          onLinkCountChange={(count) =>
            setTasks((current) =>
              current.map((candidate) =>
                candidate.id === editingTask.id ? { ...candidate, link_count: count } : candidate,
              ),
            )
          }
```

In `project-task-list.tsx`, add the same `onLinkCountChange` prop to its drawer, using `task` as the map variable. In `task-table.tsx`, import `LinkCount` and add `<LinkCount count={task.link_count ?? 0} />` right after the `SubtaskProgress` in the title cell.

- [ ] **Step 5: Run the tests and checks**

Run: `npm test`, then `npm run typecheck`, then `npm run lint`, then `npm run build`
Expected: all clean.

- [ ] **Step 6: Manual check**

Run `npm run dev` without Docker, detached from the tool console (observation 0002). Open a task. Add `https://example.com/a-very-long-path-…` with a 200-character title and confirm the row truncates without horizontal scroll. Confirm the link opens in a new tab and the board card shows the link count.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tasks/embedded-count.ts src/lib/tasks/embedded-count.test.ts src/components/tasks/link-count.tsx src/components/tasks/link-count.test.tsx "src/app/(app)/p/[projectId]/board/page.tsx" "src/app/(app)/p/[projectId]/list/page.tsx" src/components/board/project-board.tsx src/components/list/task-table.tsx src/components/list/project-task-list.tsx
git commit -m "feat(links): show link counts on board cards and list rows"
```

---

## Plan-level rulings

- **`delete_task_link` takes `p_task_id`** as well as the link id. This mirrors `delete_subtask(p_task_id, p_subtask_id)` and stops a URL whose link id belongs to a different task from deleting it. Cost if wrong: none.
- **The DELETE route is not `projectScoped`,** so a member who is not the creator sees "403 Forbidden" instead of "not found". This matches the spec's "creator or owner/admin" rule, which the UI enforces by hiding the button. Cost if wrong: a one-word change.

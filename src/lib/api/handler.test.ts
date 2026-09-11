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

function request(
  init: { method?: string; body?: unknown; origin?: string; requestId?: string } = {},
) {
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
    const ctx = handler.mock.calls[0]![0];
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

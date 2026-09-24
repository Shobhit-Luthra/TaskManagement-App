// @vitest-environment node
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { loadCalendar } from "./load";

function client(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { rpc, supabase: { rpc } as unknown as SupabaseClient };
}

describe("loadCalendar", () => {
  it("passes the window and undated flag to calendar_tasks", async () => {
    const { rpc, supabase } = client({ data: [{ id: "t1" }], error: null });
    const request = new NextRequest(
      "http://localhost:3000/api/v1/me/calendar?from=2026-08-31&to=2026-10-11&undated=1",
    );
    const response = await loadCalendar({ supabase, request, requestId: "r1", projectId: null });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("calendar_tasks", {
      p_project_id: null,
      p_from: "2026-08-31",
      p_to: "2026-10-11",
      p_include_undated: true,
    });
    expect(await response.json()).toEqual({ data: [{ id: "t1" }] });
  });

  it("rejects malformed dates without calling the database", async () => {
    const { rpc, supabase } = client({ data: [], error: null });
    const request = new NextRequest(
      "http://localhost:3000/api/v1/projects/p1/calendar?from=nope&to=2026-10-11",
    );
    const response = await loadCalendar({ supabase, request, requestId: "r1", projectId: "p1" });
    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a range rejection from the database to 422", async () => {
    const { supabase } = client({ data: null, error: { code: "22023", message: "INVALID_RANGE" } });
    const request = new NextRequest(
      "http://localhost:3000/api/v1/projects/p1/calendar?from=2026-08-31&to=2026-12-31",
    );
    const response = await loadCalendar({ supabase, request, requestId: "r1", projectId: "p1" });
    expect(response.status).toBe(422);
  });
});

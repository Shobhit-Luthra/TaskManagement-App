import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn() }) }));

import { peekInvite, acceptInvite } from "./actions";

describe("peekInvite", () => {
  it("maps P0003 to gone", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0003" } });
    const result = await peekInvite("tok");
    expect(result.error).toBe("gone");
  });

  it("maps anything else to not_found", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    const result = await peekInvite("tok");
    expect(result.error).toBe("not_found");
  });
});

describe("acceptInvite", () => {
  it("redirects to signup with next= when signed out", async () => {
    const result = await acceptInvite("tok");
    expect(result.redirect).toBe("/signup?next=/invite/tok");
  });
});

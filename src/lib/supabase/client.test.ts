import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createBrowserClient: vi.fn(() => ({ kind: "browser" })) }));

vi.mock("@supabase/ssr", () => ({ createBrowserClient: mocks.createBrowserClient }));
vi.mock("@/lib/env", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

import { createClient } from "./client";

describe("createClient", () => {
  it("creates a browser client from public configuration", () => {
    expect(createClient()).toEqual({ kind: "browser" });
    expect(mocks.createBrowserClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "anon-key",
    );
  });
});

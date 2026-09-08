import { describe, expect, it, vi } from "vitest";

describe("client env", () => {
  it("throws a helpful error when a public var is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    vi.unstubAllEnvs();
  });
});

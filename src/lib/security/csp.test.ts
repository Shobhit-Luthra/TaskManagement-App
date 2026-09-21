import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce } from "./csp";

describe("buildCsp", () => {
  it("uses the nonce and drops unsafe-inline for scripts in production", () => {
    const csp = buildCsp({
      nonce: "abc123",
      supabaseUrl: "https://proj.supabase.co",
      isDev: false,
    });
    expect(csp).toContain("script-src 'self' 'nonce-abc123'");
    expect(csp.split("; ").find((d) => d.startsWith("script-src"))).not.toContain("unsafe-inline");
  });

  it("keeps unsafe-eval for dev only, still nonce-based", () => {
    const csp = buildCsp({ nonce: "abc123", supabaseUrl: "https://proj.supabase.co", isDev: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'unsafe-eval'");
  });

  it("includes the Supabase origin and its websocket equivalent in connect-src", () => {
    const csp = buildCsp({ nonce: "x", supabaseUrl: "https://proj.supabase.co", isDev: false });
    expect(csp).toContain("connect-src 'self' https://proj.supabase.co wss://proj.supabase.co");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("appends the Sentry origin to connect-src when a DSN is set", () => {
    const csp = buildCsp({
      nonce: "x",
      supabaseUrl: "https://proj.supabase.co",
      sentryDsn: "https://key@o0.ingest.sentry.io/1",
      isDev: false,
    });
    expect(csp).toContain("https://o0.ingest.sentry.io");
    expect(csp).not.toContain("key@");
  });
});

describe("generateNonce", () => {
  it("is base64 of at least 16 random bytes and unique per call", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(Buffer.from(a, "base64").length).toBeGreaterThanOrEqual(16);
    expect(a).not.toBe(b);
  });
});

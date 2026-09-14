import { describe, expect, it, vi } from "vitest";
import { mapAuthError } from "@/lib/auth/errors";
import { securityHeaders } from "@/lib/security/headers";
import { cn } from "@/lib/utils";

describe("securityHeaders", () => {
  it("allows the configured Supabase HTTPS and websocket origins", () => {
    vi.stubEnv("NODE_ENV", "production");
    const csp = securityHeaders("https://project.supabase.co").find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;

    expect(csp).toContain(
      "connect-src 'self' https://project.supabase.co wss://project.supabase.co",
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("permits development bootstrap code only in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(securityHeaders("http://localhost:54321")[0]?.value).toContain("'unsafe-eval'");
  });
});

describe("small shared helpers", () => {
  it("keeps authentication errors enumeration-safe", () => {
    expect(mapAuthError({ status: 429 })).toContain("Too many attempts");
    expect(mapAuthError({ message: "unknown user" })).toBe(
      "We couldn't complete that request. Check your details and try again.",
    );
  });

  it("merges Tailwind conflicts", () => {
    expect(cn("p-2", false, "p-4")).toBe("p-4");
  });
});

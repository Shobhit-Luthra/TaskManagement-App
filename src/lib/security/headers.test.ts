import { describe, expect, it } from "vitest";
import { mapAuthError } from "@/lib/auth/errors";
import { securityHeaders } from "@/lib/security/headers";
import { cn } from "@/lib/utils";

describe("securityHeaders", () => {
  it("serves the static hardening headers and leaves CSP to middleware", () => {
    const keys = securityHeaders().map((header) => header.key);
    expect(keys).toEqual([
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "X-Frame-Options",
    ]);
    expect(keys).not.toContain("Content-Security-Policy");
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

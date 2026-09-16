import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { generateInviteToken } from "./token";

describe("generateInviteToken", () => {
  it("returns a base64url token whose sha256 hex matches the returned hash", () => {
    const { token, hash } = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,50}$/);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("never repeats across calls", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a.token).not.toBe(b.token);
  });
});

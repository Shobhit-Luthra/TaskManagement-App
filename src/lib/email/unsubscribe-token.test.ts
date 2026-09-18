import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";

const ORIGINAL_SECRET = process.env.UNSUBSCRIBE_SECRET;
beforeEach(() => {
  process.env.UNSUBSCRIBE_SECRET = "test-unsubscribe-secret";
});
afterEach(() => {
  process.env.UNSUBSCRIBE_SECRET = ORIGINAL_SECRET;
  vi.useRealTimers();
});

describe("unsubscribe token", () => {
  it("round-trips userId and category", () => {
    const token = generateUnsubscribeToken("11111111-1111-1111-1111-111111111111", "digest");
    const result = verifyUnsubscribeToken(token);
    expect(result).toEqual({ userId: "11111111-1111-1111-1111-111111111111", category: "digest" });
  });

  it("rejects a tampered payload", () => {
    const token = generateUnsubscribeToken("11111111-1111-1111-1111-111111111111", "digest");
    const [payload = "", sig = ""] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, "base64url").toString()),
        category: "assignment",
      }),
    ).toString("base64url");
    expect(verifyUnsubscribeToken(`${tamperedPayload}.${sig}`)).toBeNull();
  });

  it("rejects a garbage token without throwing", () => {
    expect(verifyUnsubscribeToken("not-a-token")).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
  });

  it("expires after 30 days", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = generateUnsubscribeToken("11111111-1111-1111-1111-111111111111", "digest");
    vi.setSystemTime(new Date("2026-01-30T23:59:59Z"));
    expect(verifyUnsubscribeToken(token)).not.toBeNull();
    vi.setSystemTime(new Date("2026-02-01T00:00:01Z"));
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("is single-purpose — a token for one category never verifies as another", () => {
    const token = generateUnsubscribeToken("11111111-1111-1111-1111-111111111111", "assignment");
    const result = verifyUnsubscribeToken(token);
    expect(result?.category).toBe("assignment");
    expect(result?.category).not.toBe("digest");
  });
});

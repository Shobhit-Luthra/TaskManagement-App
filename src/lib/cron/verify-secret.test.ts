import { describe, expect, it } from "vitest";
import { verifyCronSecret } from "./verify-secret";

describe("verifyCronSecret", () => {
  it("accepts the exact expected secret", () => {
    expect(verifyCronSecret("shh", "shh")).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(verifyCronSecret("nope", "shh")).toBe(false);
  });

  it("rejects a missing provided value", () => {
    expect(verifyCronSecret(null, "shh")).toBe(false);
  });

  it("rejects a missing expected value without throwing", () => {
    expect(verifyCronSecret("shh", "")).toBe(false);
  });

  it("rejects a different-length secret without throwing", () => {
    expect(verifyCronSecret("s", "shh")).toBe(false);
  });
});

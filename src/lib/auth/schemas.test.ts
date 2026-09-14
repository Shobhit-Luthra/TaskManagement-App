import { describe, expect, it } from "vitest";
import { passwordSchema, signUpSchema, resetPasswordSchema } from "./schemas";

describe("passwordSchema", () => {
  it("rejects passwords shorter than 10 characters", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
  });
  it("accepts a 10+ character password", () => {
    expect(passwordSchema.safeParse("abcdefghij").success).toBe(true);
  });
  it("accepts at most 128 characters", () => {
    expect(passwordSchema.safeParse("a".repeat(128)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(129)).success).toBe(false);
  });
});

describe("signUpSchema", () => {
  it("trims and requires a display name of 1-80 chars", () => {
    expect(
      signUpSchema.safeParse({ email: "a@b.com", password: "abcdefghij", displayName: "  " })
        .success,
    ).toBe(false);
    const ok = signUpSchema.safeParse({
      email: "a@b.com",
      password: "abcdefghij",
      displayName: "  Aditi  ",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.displayName).toBe("Aditi");
  });
});

describe("resetPasswordSchema", () => {
  it("fails when passwords do not match", () => {
    expect(
      resetPasswordSchema.safeParse({ password: "abcdefghij", confirmPassword: "different99" })
        .success,
    ).toBe(false);
  });
});

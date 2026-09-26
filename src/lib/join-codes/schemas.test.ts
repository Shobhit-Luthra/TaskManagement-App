import { describe, expect, it } from "vitest";
import {
  decideJoinRequestSchema,
  grantableRoles,
  isJoinCodeActive,
  normalizeJoinCode,
  requestToJoinSchema,
} from "./schemas";

describe("requestToJoinSchema", () => {
  it("accepts exactly six digits, trimming whitespace", () => {
    expect(requestToJoinSchema.parse({ code: " 012345 " })).toEqual({ code: "012345" });
  });

  it.each(["12345", "1234567", "12a456", "", "12 345"])("rejects %j", (code) => {
    expect(requestToJoinSchema.safeParse({ code }).success).toBe(false);
  });
});

describe("decideJoinRequestSchema", () => {
  it("requires a role to approve", () => {
    expect(decideJoinRequestSchema.safeParse({ decision: "approve" }).success).toBe(false);
    expect(decideJoinRequestSchema.parse({ decision: "approve", role: "member" })).toEqual({
      decision: "approve",
      role: "member",
    });
  });

  it("never accepts owner", () => {
    expect(decideJoinRequestSchema.safeParse({ decision: "approve", role: "owner" }).success).toBe(
      false,
    );
  });

  it("denies without a role", () => {
    expect(decideJoinRequestSchema.parse({ decision: "deny" })).toEqual({ decision: "deny" });
  });
});

describe("grantableRoles", () => {
  it("lets an owner grant admin, member or viewer", () => {
    expect(grantableRoles("owner")).toEqual(["admin", "member", "viewer"]);
  });
  it("lets an admin grant only member or viewer", () => {
    expect(grantableRoles("admin")).toEqual(["member", "viewer"]);
  });
  it("gives members and viewers nothing", () => {
    expect(grantableRoles("member")).toEqual([]);
    expect(grantableRoles("viewer")).toEqual([]);
  });
});

describe("normalizeJoinCode", () => {
  it("keeps the first six digits of pasted text", () => {
    expect(normalizeJoinCode("Code: 123-456-789")).toBe("123456");
  });
});

describe("isJoinCodeActive", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  it("is false with no code, a disabled code or an expired code", () => {
    expect(isJoinCodeActive(null, now)).toBe(false);
    expect(
      isJoinCodeActive(
        { code: "123456", expires_at: "2026-10-01T00:00:00Z", disabled_at: "2026-09-25T00:00:00Z" },
        now,
      ),
    ).toBe(false);
    expect(
      isJoinCodeActive(
        { code: "123456", expires_at: "2026-09-26T11:00:00Z", disabled_at: null },
        now,
      ),
    ).toBe(false);
  });
  it("is true for a live code", () => {
    expect(
      isJoinCodeActive(
        { code: "123456", expires_at: "2026-10-01T00:00:00Z", disabled_at: null },
        now,
      ),
    ).toBe(true);
  });
});

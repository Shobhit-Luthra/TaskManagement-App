import { describe, expect, it } from "vitest";
import { addDaysToDateString, todayInTimeZone } from "./timezone";

describe("project timezone dates", () => {
  it("uses the project's calendar day", () => {
    const now = new Date("2026-09-17T23:30:00Z");
    expect(todayInTimeZone(now, "UTC")).toBe("2026-09-17");
    expect(todayInTimeZone(now, "Asia/Kolkata")).toBe("2026-09-18");
  });
  it("adds calendar days without month drift", () =>
    expect(addDaysToDateString("2026-09-27", 7)).toBe("2026-10-04"));
});

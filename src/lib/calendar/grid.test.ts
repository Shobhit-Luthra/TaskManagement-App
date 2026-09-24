import { describe, expect, it } from "vitest";
import {
  groupByDueDate,
  monthLabel,
  shiftAnchor,
  startOfWeek,
  visibleDays,
  visibleRange,
} from "./grid";

describe("calendar grid", () => {
  it("builds a 42-day Monday-first month grid", () => {
    const days = visibleDays("month", "2026-09-24");
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-08-31");
    expect(days[41]).toBe("2026-10-11");
    expect(visibleRange("month", "2026-09-24")).toEqual({ from: "2026-08-31", to: "2026-10-11" });
  });

  it("handles months starting on a Sunday or a Monday", () => {
    const february = visibleDays("month", "2026-02-10");
    expect([february[0], february[41]]).toEqual(["2026-01-26", "2026-03-08"]);
    const march = visibleDays("month", "2027-03-15");
    expect([march[0], march[41]]).toEqual(["2027-03-01", "2027-04-11"]);
  });

  it("builds a Monday-to-Sunday week", () => {
    expect(visibleDays("week", "2026-09-24")).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
    ]);
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21");
    expect(startOfWeek("2026-09-21")).toBe("2026-09-21");
  });

  it("shifts months by calendar month and weeks by seven days", () => {
    expect(shiftAnchor("month", "2026-01-31", -1)).toBe("2025-12-01");
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftAnchor("month", "2026-12-05", 1)).toBe("2027-01-01");
    expect(shiftAnchor("week", "2026-12-30", 1)).toBe("2027-01-06");
  });

  it("groups dated tasks and skips undated ones", () => {
    const groups = groupByDueDate([
      { id: "a", due_date: "2026-09-24" },
      { id: "b", due_date: null },
      { id: "c", due_date: "2026-09-24" },
    ]);
    expect([...groups]).toEqual([
      [
        "2026-09-24",
        [
          { id: "a", due_date: "2026-09-24" },
          { id: "c", due_date: "2026-09-24" },
        ],
      ],
    ]);
  });

  it("labels the anchor month", () => {
    expect(monthLabel("2026-09-24")).toBe("September 2026");
  });
});

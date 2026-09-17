import { describe, expect, it } from "vitest";
import { applyFilters, type FilterableTask } from "./apply";
import { EMPTY_FILTER_STATE } from "./schema";

const task = (overrides: Partial<FilterableTask>): FilterableTask => ({
  id: "t",
  title: "Untitled",
  description: null,
  priority: "medium",
  due_date: null,
  assignee_id: null,
  label_ids: [],
  isDone: false,
  ...overrides,
});
const ctx = { projectTimezone: "UTC", now: new Date("2026-09-17T12:00:00Z") };

describe("applyFilters", () => {
  it("combines dimensions with AND and values within a dimension with OR", () => {
    const tasks = [
      task({ id: "a", assignee_id: "u1", priority: "low", label_ids: ["design"] }),
      task({ id: "b", assignee_id: "u2", priority: "high", label_ids: ["bug"] }),
      task({ id: "c", assignee_id: "u1", priority: "high", label_ids: ["bug", "design"] }),
    ];
    expect(
      applyFilters(tasks, { ...EMPTY_FILTER_STATE, assignee: ["u1"], priority: ["high"] }, ctx).map(
        (item) => item.id,
      ),
    ).toEqual(["c"]);
    expect(
      applyFilters(tasks, { ...EMPTY_FILTER_STATE, label: ["design"] }, ctx).map((item) => item.id),
    ).toEqual(["a", "c"]);
  });
  it("searches title and description without regard to case", () => {
    const tasks = [
      task({ id: "a", title: "Ship launch" }),
      task({ id: "b", description: "LAUNCH notes" }),
    ];
    expect(
      applyFilters(tasks, { ...EMPTY_FILTER_STATE, q: "launch" }, ctx).map((item) => item.id),
    ).toEqual(["a", "b"]);
  });
  it("handles due states in the project timezone", () => {
    const tasks = [
      task({ id: "old", due_date: "2026-09-16" }),
      task({ id: "done", due_date: "2026-09-16", isDone: true }),
      task({ id: "today", due_date: "2026-09-17" }),
      task({ id: "none" }),
    ];
    expect(
      applyFilters(tasks, { ...EMPTY_FILTER_STATE, due: "overdue" }, ctx).map((item) => item.id),
    ).toEqual(["old"]);
    expect(
      applyFilters(tasks, { ...EMPTY_FILTER_STATE, due: "none" }, ctx).map((item) => item.id),
    ).toEqual(["none"]);
    expect(
      applyFilters(
        [task({ id: "ist", due_date: "2026-09-18" })],
        { ...EMPTY_FILTER_STATE, due: "today" },
        { projectTimezone: "Asia/Kolkata", now: new Date("2026-09-17T23:30:00Z") },
      ).map((item) => item.id),
    ).toEqual(["ist"]);
  });
});

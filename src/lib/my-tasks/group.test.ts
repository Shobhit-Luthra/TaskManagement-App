import { describe, expect, it } from "vitest";
import { groupByDueState, type MyTask } from "./group";

const task = (overrides: Partial<MyTask>): MyTask => ({
  id: "t",
  title: "Task",
  priority: "medium",
  due_date: null,
  isDone: false,
  projectId: "p",
  projectName: "Project",
  projectTimezone: "UTC",
  columnName: "Todo",
  ...overrides,
});
describe("groupByDueState", () => {
  it("buckets due states and ignores completed tasks", () => {
    const groups = groupByDueState(
      [
        task({ id: "old", due_date: "2026-09-16" }),
        task({ id: "today", due_date: "2026-09-17" }),
        task({ id: "week", due_date: "2026-09-20" }),
        task({ id: "later", due_date: "2026-10-01" }),
        task({ id: "none" }),
        task({ id: "done", due_date: "2026-09-01", isDone: true }),
      ],
      new Date("2026-09-17T12:00:00Z"),
    );
    expect(groups.overdue.map((item) => item.id)).toEqual(["old"]);
    expect(groups.today.map((item) => item.id)).toEqual(["today"]);
    expect(groups.week.map((item) => item.id)).toEqual(["week"]);
    expect(groups.later.map((item) => item.id)).toEqual(["later"]);
    expect(groups.none.map((item) => item.id)).toEqual(["none"]);
  });
  it("uses each task's own project timezone", () => {
    const groups = groupByDueState(
      [
        task({ id: "utc", due_date: "2026-09-18" }),
        task({ id: "ist", due_date: "2026-09-18", projectTimezone: "Asia/Kolkata" }),
      ],
      new Date("2026-09-17T23:30:00Z"),
    );
    expect(groups.today.map((item) => item.id)).toEqual(["ist"]);
    expect(groups.week.map((item) => item.id)).toEqual(["utc"]);
  });
});

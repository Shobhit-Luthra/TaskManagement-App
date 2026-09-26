import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProgressOverview, progressPercent } from "./progress-overview";
import {
  MemberProgressTable,
  sortMemberRows,
  type MemberProgressRow,
} from "./member-progress-table";
import { AtRiskList, dueLabel } from "./at-risk-list";
import { BreakdownChart, orderPriorityRows, type BreakdownRow } from "./breakdown-chart";

const column = (name: string, taskCount: number, isDone = false) => ({
  columnId: name,
  name,
  isDone,
  taskCount,
});

describe("ProgressOverview", () => {
  it("rounds the done percentage and handles an empty board", () => {
    expect(progressPercent([column("To Do", 2), column("Done", 1, true)])).toBe(33);
    expect(progressPercent([])).toBe(0);
  });

  it("shows percent, counts and a legend entry per column", () => {
    render(<ProgressOverview rows={[column("To Do", 3), column("Done", 1, true)]} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("1 of 4 tasks done")).toBeInTheDocument();
    const legend = screen.getByRole("list", { name: "Tasks by column" });
    expect(within(legend).getByText("To Do")).toBeInTheDocument();
  });

  it("folds columns past the sixth into Other instead of reusing colors", () => {
    const rows = Array.from({ length: 8 }, (_, i) => column(`C${i + 1}`, 1));
    render(<ProgressOverview rows={rows} />);
    expect(screen.getByText("Other (2 columns)")).toBeInTheDocument();
    expect(screen.queryByText("C7")).not.toBeInTheDocument();
  });

  it("explains an empty board", () => {
    render(<ProgressOverview rows={[column("To Do", 0)]} />);
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

const member = (name: string, openCount: number, id: string | null = name): MemberProgressRow => ({
  memberUserId: id,
  displayName: name,
  role: id ? "member" : null,
  openCount,
  inProgressCount: 0,
  completedInPeriod: 0,
  overdueCount: 0,
  dueSoonCount: 0,
});

describe("MemberProgressTable", () => {
  const rows = [member("Unassigned", 9, null), member("Ana", 1), member("Bo", 5)];

  it("keeps Unassigned last whatever the sort", () => {
    expect(sortMemberRows(rows, "openCount", "desc").map((r) => r.displayName)).toEqual([
      "Bo",
      "Ana",
      "Unassigned",
    ]);
    expect(sortMemberRows(rows, "displayName", "asc").map((r) => r.displayName)).toEqual([
      "Ana",
      "Bo",
      "Unassigned",
    ]);
  });

  it("re-sorts when a header is clicked and reports aria-sort", async () => {
    render(<MemberProgressTable rows={rows} />);
    const names = () =>
      screen.getAllByRole("rowheader").map((cell) => cell.textContent?.replace(/member$/, ""));
    expect(names()).toEqual(["Bo", "Ana", "Unassigned"]);
    await userEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(names()).toEqual(["Ana", "Bo", "Unassigned"]);
    expect(screen.getByRole("columnheader", { name: /open/i })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });
});

describe("AtRiskList", () => {
  it("labels due dates in words", () => {
    expect(dueLabel({ isOverdue: true, daysUntilDue: -1 })).toBe("Overdue by 1 day");
    expect(dueLabel({ isOverdue: true, daysUntilDue: -4 })).toBe("Overdue by 4 days");
    expect(dueLabel({ isOverdue: false, daysUntilDue: 0 })).toBe("Due today");
    expect(dueLabel({ isOverdue: false, daysUntilDue: 1 })).toBe("Due tomorrow");
    expect(dueLabel({ isOverdue: false, daysUntilDue: 3 })).toBe("Due in 3 days");
  });

  it("links each task to its board drawer", () => {
    render(
      <AtRiskList
        projectId="p1"
        tasks={[
          {
            taskId: "t1",
            title: "Ship it",
            dueDate: "2026-09-20",
            priority: "high",
            columnName: "Doing",
            assigneeName: null,
            isOverdue: true,
            daysUntilDue: -6,
          },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: /ship it/i })).toHaveAttribute(
      "href",
      "/p/p1/board?task=t1",
    );
    expect(screen.getByText("1 overdue · 0 due within 3 days")).toBeInTheDocument();
    expect(screen.getByText(/unassigned/i)).toBeInTheDocument();
  });

  it("says when nothing is at risk", () => {
    render(<AtRiskList projectId="p1" tasks={[]} />);
    expect(screen.getByText(/nothing is overdue/i)).toBeInTheDocument();
  });
});

const breakdown = (
  dimension: BreakdownRow["dimension"],
  key: string,
  openCount = 0,
  doneCount = 0,
): BreakdownRow => ({ dimension, key, name: key, color: null, openCount, doneCount });

describe("BreakdownChart", () => {
  it("orders priorities from urgent to low", () => {
    const rows = ["low", "urgent", "medium", "high"].map((key) => breakdown("priority", key));
    expect(orderPriorityRows(rows).map((r) => r.key)).toEqual(["urgent", "high", "medium", "low"]);
  });

  it("shows counts as text and caps labels at ten", () => {
    const rows = [
      breakdown("priority", "high", 2, 1),
      ...Array.from({ length: 12 }, (_, i) => breakdown("label", `L${i}`, 1, 0)),
    ];
    render(<BreakdownChart rows={rows} />);
    expect(screen.getByText("2 open")).toBeInTheDocument();
    expect(screen.getByText("and 2 more labels")).toBeInTheDocument();
  });

  it("explains a board without labels", () => {
    render(<BreakdownChart rows={[breakdown("priority", "low")]} />);
    expect(screen.getByText(/no labels yet/i)).toBeInTheDocument();
  });
});

import { DndContext } from "@dnd-kit/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { visibleDays } from "@/lib/calendar/grid";
import { CalendarChipOverlay, CalendarGrid } from "./calendar-grid";
import type { CalendarTask } from "./use-calendar-tasks";

const base: CalendarTask = {
  id: "t0",
  project_id: "p1",
  project_name: "Launch",
  title: "Task 0",
  description: null,
  due_date: "2026-09-24",
  priority: "medium",
  column_id: "c1",
  column_name: "To do",
  is_done: false,
  assignee_id: null,
  updated_at: "2026-09-01T00:00:00Z",
  can_edit: true,
  subtask_done: 0,
  subtask_total: 0,
};
const five = Array.from({ length: 5 }, (_, index) => ({
  ...base,
  id: `t${index}`,
  title: `Task ${index}`,
}));

function renderGrid(showProject = false) {
  return render(
    <DndContext>
      <CalendarGrid
        view="month"
        days={visibleDays("month", "2026-09-24")}
        month="2026-09"
        today="2026-09-24"
        tasksByDay={new Map([["2026-09-24", five]])}
        showProject={showProject}
      />
    </DndContext>,
  );
}

it("renders 42 days and marks today", () => {
  renderGrid();
  expect(screen.getAllByRole("cell")).toHaveLength(42);
  const today = screen.getByRole("cell", { name: "Thursday, September 24" });
  expect(today).toHaveAttribute("aria-current", "date");
});

it("shows three chips per day and expands the rest", async () => {
  renderGrid();
  const today = screen.getByRole("cell", { name: "Thursday, September 24" });
  expect(within(today).getAllByRole("link")).toHaveLength(3);
  await userEvent.click(within(today).getByRole("button", { name: "+2 more" }));
  expect(within(today).getAllByRole("link")).toHaveLength(5);
});

it("links chips to the task drawer on the board", () => {
  renderGrid(true);
  expect(screen.getByRole("link", { name: "Task 0" })).toHaveAttribute(
    "href",
    "/p/p1/board?task=t0",
  );
  expect(screen.getAllByText("Launch").length).toBeGreaterThan(0);
});

it("renders the drag overlay chip with no link, so releasing over it cannot navigate away", () => {
  render(<CalendarChipOverlay task={base} showProject={false} />);
  expect(screen.getByText("Task 0")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

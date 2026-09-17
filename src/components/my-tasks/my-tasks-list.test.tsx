import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MyTasksList } from "./my-tasks-list";

const task = {
  id: "t1",
  title: "Task",
  priority: "medium" as const,
  due_date: "2026-09-17",
  isDone: false,
  projectId: "p1",
  projectName: "Project",
  projectTimezone: "UTC",
  columnName: "Todo",
};
describe("MyTasksList", () => {
  it("renders only populated groups and links to the source board", () => {
    render(<MyTasksList tasks={[task]} now={new Date("2026-09-17T12:00:00Z")} />);
    expect(screen.getByRole("heading", { name: /due today/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /overdue/i })).toBeNull();
    expect(screen.getByRole("link", { name: /task/i })).toHaveAttribute(
      "href",
      "/p/p1/board?task=t1",
    );
  });
  it("shows a useful empty state", () => {
    render(<MyTasksList tasks={[]} now={new Date()} />);
    expect(screen.getByText(/nothing assigned to you/i)).toBeInTheDocument();
  });
});

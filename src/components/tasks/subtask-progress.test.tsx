import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SubtaskProgress } from "./subtask-progress";

it("shows progress with an accessible description", () => {
  render(<SubtaskProgress done={2} total={5} />);
  expect(screen.getByText("2/5")).toBeInTheDocument();
  expect(screen.getByText("2 of 5 subtasks complete")).toBeInTheDocument();
});

it("renders nothing without subtasks", () => {
  const { container } = render(<SubtaskProgress done={0} total={0} />);
  expect(container).toBeEmptyDOMElement();
});

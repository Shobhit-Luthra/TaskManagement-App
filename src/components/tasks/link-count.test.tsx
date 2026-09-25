import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { LinkCount } from "./link-count";

it("shows the count with an accessible description", () => {
  render(<LinkCount count={2} />);
  expect(screen.getByText("2 links")).toBeInTheDocument();
});

it("uses the singular and hides at zero", () => {
  const { rerender, container } = render(<LinkCount count={1} />);
  expect(screen.getByText("1 link")).toBeInTheDocument();
  rerender(<LinkCount count={0} />);
  expect(container).toBeEmptyDOMElement();
});

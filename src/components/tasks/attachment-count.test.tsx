import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AttachmentCount } from "./attachment-count";

it("shows the count with an accessible description", () => {
  render(<AttachmentCount count={2} />);
  expect(screen.getByText("2 attachments")).toBeInTheDocument();
});

it("uses the singular and hides at zero", () => {
  const { rerender, container } = render(<AttachmentCount count={1} />);
  expect(screen.getByText("1 attachment")).toBeInTheDocument();
  rerender(<AttachmentCount count={0} />);
  expect(container).toBeEmptyDOMElement();
});

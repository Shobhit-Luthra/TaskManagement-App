import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LabelPicker } from "./label-picker";

const labels = [
  { id: "l1", name: "Bug", color: "#EF4444" },
  { id: "l2", name: "Feature", color: "#3B82F6" },
];

describe("LabelPicker", () => {
  it("uses visible label names, not colour only", () => {
    render(
      <LabelPicker labels={labels} selectedIds={["l1"]} onChange={vi.fn()} readOnly={false} />,
    );
    expect(screen.getByText("Bug")).toBeInTheDocument();
    expect(screen.getByText("Feature")).toBeInTheDocument();
  });
  it("toggles the selected id set", async () => {
    const onChange = vi.fn();
    render(
      <LabelPicker labels={labels} selectedIds={["l1"]} onChange={onChange} readOnly={false} />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "Feature" }));
    expect(onChange).toHaveBeenCalledWith(["l1", "l2"]);
  });
  it("is inert on a read-only board", () => {
    render(<LabelPicker labels={labels} selectedIds={[]} onChange={vi.fn()} readOnly />);
    expect(screen.getByRole("checkbox", { name: "Bug" })).toBeDisabled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LabelsSettings } from "./labels-settings";

const labels = [{ id: "l1", name: "Bug", color: "#EF4444", created_at: "2026-09-20" }];

describe("LabelsSettings", () => {
  it("creates a label with the submitted name and colour", async () => {
    const onCreate = vi.fn();
    render(
      <LabelsSettings
        labels={labels}
        canManage
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText("Name"), "Urgent");
    await userEvent.click(screen.getByRole("button", { name: "Add label" }));
    expect(onCreate).toHaveBeenCalledWith({ name: "Urgent", color: "#6366F1" });
  });

  it("hides management controls for a non-owner or admin", () => {
    render(
      <LabelsSettings
        labels={labels}
        canManage={false}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Add label" })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete bug/i })).toBeNull();
  });
  it("updates a label after entering edit mode", async () => {
    const onUpdate = vi.fn();
    render(
      <LabelsSettings
        labels={labels}
        canManage
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Edit Bug" }));
    const input = screen.getByRole("textbox", { name: "Name for Bug" });
    await userEvent.clear(input);
    await userEvent.type(input, "Defect");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onUpdate).toHaveBeenCalledWith("l1", { name: "Defect", color: "#EF4444" });
  });
});

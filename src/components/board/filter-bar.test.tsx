import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_FILTER_STATE } from "@/lib/filters/schema";
import { FilterBar } from "./filter-bar";

const peers = [
  { userId: "u1", displayName: "Ada" },
  { userId: "u2", displayName: "Grace" },
];
const labels = [{ id: "l1", name: "Bug", color: "#EF4444" }];

describe("FilterBar", () => {
  it("adds an assignee to its OR filter dimension", async () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        filters={EMPTY_FILTER_STATE}
        onChange={onChange}
        onClear={vi.fn()}
        peers={peers}
        labels={labels}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Assignee" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Grace" }));
    expect(onChange).toHaveBeenCalledWith({ assignee: ["u2"] });
  });
  it("renders and removes active filter chips", async () => {
    const onChange = vi.fn();
    render(
      <FilterBar
        filters={{ ...EMPTY_FILTER_STATE, priority: ["high"] }}
        onChange={onChange}
        onClear={vi.fn()}
        peers={peers}
        labels={labels}
      />,
    );
    expect(screen.getByRole("button", { name: "Remove high" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove high" }));
    expect(onChange).toHaveBeenCalledWith({ priority: [] });
  });
});

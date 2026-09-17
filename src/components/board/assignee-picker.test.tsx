import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssigneePicker } from "./assignee-picker";

const from = vi.fn(() => ({
  select: () => ({
    order: async () => ({
      data: [
        { id: "u1", display_name: "Ada" },
        { id: "u2", display_name: "Grace" },
      ],
    }),
  }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from }) }));

describe("AssigneePicker", () => {
  it("loads project peers and reports a selected user", async () => {
    const onChange = vi.fn();
    render(
      <AssigneePicker projectId="project-1" value={null} onChange={onChange} disabled={false} />,
    );
    await waitFor(() => expect(screen.getByText("Ada")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Assignee"), "u1");
    expect(onChange).toHaveBeenCalledWith("u1");
  });

  it("maps the unassigned option to null", async () => {
    const onChange = vi.fn();
    render(
      <AssigneePicker projectId="project-1" value="u1" onChange={onChange} disabled={false} />,
    );
    await waitFor(() => expect(screen.getByText("Grace")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Assignee"), "");
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

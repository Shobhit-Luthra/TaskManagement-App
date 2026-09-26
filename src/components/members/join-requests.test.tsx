import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JoinRequests } from "./join-requests";

const request = {
  id: "req-1",
  user_id: "user-2",
  display_name: "Priya",
  email: "priya@example.com",
  avatar_url: null,
  created_at: "2026-09-26T10:00:00Z",
};

describe("JoinRequests", () => {
  it("renders nothing without requests", () => {
    const { container } = render(
      <JoinRequests requests={[]} grantableRoles={["member"]} onDecide={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("requires choosing a role before approving", async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(
      <JoinRequests
        requests={[request]}
        grantableRoles={["member", "viewer"]}
        onDecide={onDecide}
      />,
    );
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Role for Priya"), "viewer");
    expect(approve).toBeEnabled();
    await userEvent.click(approve);
    expect(onDecide).toHaveBeenCalledWith("req-1", "approve", "viewer");
  });

  it("offers only the roles the approver can grant", () => {
    render(
      <JoinRequests
        requests={[request]}
        grantableRoles={["member", "viewer"]}
        onDecide={vi.fn()}
      />,
    );
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Choose role", "Member", "Viewer"]);
  });

  it("denies without a role", async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(<JoinRequests requests={[request]} grantableRoles={["member"]} onDecide={onDecide} />);
    await userEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onDecide).toHaveBeenCalledWith("req-1", "deny", undefined);
  });
});

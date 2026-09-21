import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DangerZone } from "./danger-zone";

describe("DangerZone", () => {
  it("disables the delete button until the confirmation phrase matches", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<DangerZone onDelete={onDelete} confirmationPhrase="delete my account" />);
    const button = screen.getByRole("button", { name: /delete account/i });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/type.*to confirm/i), "delete my account");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onDelete).toHaveBeenCalled();
  });

  it("shows the blocked-projects message on a 409 from the server", async () => {
    const onDelete = vi
      .fn()
      .mockRejectedValue(
        Object.assign(
          new Error(
            "You're the only Owner on one or more projects. Transfer ownership or delete those projects before deleting your account.",
          ),
          { blockedProjects: [{ projectId: "p1", projectName: "Launch Plan" }] },
        ),
      );
    render(<DangerZone onDelete={onDelete} confirmationPhrase="delete my account" />);
    await userEvent.type(screen.getByLabelText(/type.*to confirm/i), "delete my account");
    await userEvent.click(screen.getByRole("button", { name: /delete account/i }));
    expect(await screen.findByText(/only Owner/i)).toBeInTheDocument();
    expect(screen.getByText("Launch Plan")).toBeInTheDocument();
  });
});

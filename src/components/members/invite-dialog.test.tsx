import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InviteDialog } from "./invite-dialog";

describe("InviteDialog", () => {
  it("submits email and role", async () => {
    const onInvite = vi.fn().mockResolvedValue(undefined);
    render(<InviteDialog open onOpenChange={vi.fn()} onInvite={onInvite} />);
    await userEvent.type(screen.getByLabelText(/email/i), "person@example.com");
    await userEvent.selectOptions(screen.getByLabelText(/role/i), "admin");
    await userEvent.click(screen.getByRole("button", { name: /send invite/i }));
    expect(onInvite).toHaveBeenCalledWith({ email: "person@example.com", role: "admin" });
  });

  it("shows the server's error message on failure", async () => {
    const onInvite = vi.fn().mockRejectedValue(new Error("That person is already a member."));
    render(<InviteDialog open onOpenChange={vi.fn()} onInvite={onInvite} />);
    await userEvent.type(screen.getByLabelText(/email/i), "person@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send invite/i }));
    expect(await screen.findByText("That person is already a member.")).toBeInTheDocument();
  });
});

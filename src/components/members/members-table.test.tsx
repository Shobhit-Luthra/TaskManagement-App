import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MembersTable } from "./members-table";

const members = [
  { userId: "u-owner", role: "owner" as const, displayName: "Ada Owner" },
  { userId: "u-member", role: "member" as const, displayName: "Bo Member" },
];

describe("MembersTable", () => {
  it("disables the role dropdown for the Owner row", () => {
    render(
      <MembersTable
        members={members}
        currentUserId="u-owner"
        currentUserRole="owner"
        onRoleChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const ownerRow = screen.getByText("Ada Owner").closest("tr")!;
    expect(within(ownerRow).getByRole("combobox")).toBeDisabled();
  });

  it("a Member viewing the table sees no role controls at all", () => {
    render(
      <MembersTable
        members={members}
        currentUserId="u-member"
        currentUserRole="member"
        onRoleChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: /remove/i })).toHaveLength(0);
  });

  it("an Admin can change a Member's role", async () => {
    const onRoleChange = vi.fn();
    render(
      <MembersTable
        members={members}
        currentUserId="u-owner"
        currentUserRole="admin"
        onRoleChange={onRoleChange}
        onRemove={vi.fn()}
      />,
    );
    const memberRow = screen.getByText("Bo Member").closest("tr")!;
    await userEvent.selectOptions(within(memberRow).getByRole("combobox"), "viewer");
    expect(onRoleChange).toHaveBeenCalledWith("u-member", "viewer");
  });
});

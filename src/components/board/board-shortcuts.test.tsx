import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectBoard } from "./project-board";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/p/p1/board",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/realtime/use-project-channel", () => ({ useProjectChannel: () => "connected" }));
vi.mock("./assignee-picker", () => ({ AssigneePicker: () => null }));

describe("board shortcut integration", () => {
  it("toggles filters, reveals search, focuses creation, and opens dismissible help", async () => {
    const user = userEvent.setup();
    render(
      <ProjectBoard
        projectId="p1"
        currentUserId="u1"
        initialColumns={[{ id: "c1", name: "Todo", position: 1, wip_limit: null }]}
        initialTasks={[]}
        readOnly={false}
        currentUserRole="owner"
        peers={[]}
        projectLabels={[]}
        projectTimezone="UTC"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Hide filters" }));
    expect(screen.queryByRole("textbox", { name: "Search tasks" })).toBeNull();
    await user.keyboard("/");
    expect(screen.getByRole("textbox", { name: "Search tasks" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Hide filters" }));
    await user.keyboard("n");
    expect(screen.getByRole("textbox", { name: "New task in this column" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Show filters" }));
    await user.keyboard("?");
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

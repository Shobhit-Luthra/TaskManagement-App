import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskComposer } from "./project-board";

vi.mock("@/lib/realtime/use-project-channel", () => ({
  useProjectChannel: () => "connected",
}));
vi.mock("./assignee-picker", () => ({
  AssigneePicker: () => null,
}));

afterEach(() => vi.restoreAllMocks());

describe("TaskComposer network retry", () => {
  it("retains an unsaved task and retries it after a network failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: "task-1",
            column_id: "column-1",
            title: "Recover this task",
            description: null,
            due_date: null,
            priority: "medium",
            position: 1000,
            created_at: "",
            updated_at: "",
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const onCreated = vi.fn();
    render(<TaskComposer projectId="project-1" columnId="column-1" onCreated={onCreated} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("New task in this column"), "Recover this task");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getByText(/unsaved/i)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "task-1" })),
    );
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});

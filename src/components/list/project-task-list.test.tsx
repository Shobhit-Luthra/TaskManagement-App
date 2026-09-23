import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectTaskList } from "./project-task-list";
import type { BoardTask } from "@/components/board/project-board";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/p/p1/list",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/realtime/use-project-channel", () => ({ useProjectChannel: () => "connected" }));
afterEach(() => vi.unstubAllGlobals());
const task: BoardTask = {
  id: "t1",
  title: "Launch",
  description: "Keep description",
  column_id: "c1",
  priority: "medium",
  due_date: null,
  assignee_id: "u1",
  position: 1,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};
const props = {
  projectId: "p1",
  currentUserId: "u1",
  initialTasks: [task],
  initialColumns: [{ id: "c1", name: "Todo", position: 1, wip_limit: null }],
  peers: [{ userId: "u1", displayName: "Ada" }],
  labels: [],
  projectTimezone: "UTC",
  readOnly: false,
};

describe("list inline updates", () => {
  it("preserves other fields and rolls back a rejected edit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProjectTaskList {...props} />);
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Priority for Launch" }),
      "high",
    );
    await screen.findByRole("alert");
    expect(screen.getByRole("combobox", { name: "Priority for Launch" })).toHaveValue("medium");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
      description: "Keep description",
      assigneeId: "u1",
      priority: "high",
      expectedUpdatedAt: task.updated_at,
    });
  });
  it("shows the latest server value after a conflict", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: { details: { current: { ...task, priority: "urgent" } } } }),
      }),
    );
    render(<ProjectTaskList {...props} />);
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Priority for Launch" }),
      "high",
    );
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("changed elsewhere"));
    expect(screen.getByRole("combobox", { name: "Priority for Launch" })).toHaveValue("urgent");
  });
  it("does not expose editing controls to viewers", () => {
    render(<ProjectTaskList {...props} readOnly />);
    expect(screen.queryByRole("combobox", { name: "Priority for Launch" })).toBeNull();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });
});

vi.mock("@/components/board/assignee-picker", () => ({ AssigneePicker: () => null }));
vi.mock("@/components/board/task-activity", () => ({ TaskActivity: () => null }));

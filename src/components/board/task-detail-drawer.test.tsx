import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TaskDetailDrawer } from "./task-detail-drawer";

vi.mock("./assignee-picker", () => ({ AssigneePicker: () => null }));
vi.mock("./task-activity", () => ({ TaskActivity: () => null }));
vi.mock("./comment-thread", () => ({
  CommentThread: () => (
    <form aria-label="Comment form">
      <input aria-label="Comment" />
    </form>
  ),
}));
afterEach(() => vi.unstubAllGlobals());

const task = {
  id: "t1",
  column_id: "c1",
  title: "Release notes",
  description: null,
  priority: "medium" as const,
  due_date: null,
  position: 1,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};
const props = {
  task,
  projectId: "p1",
  currentUserId: "u1",
  currentUserRole: "member" as const,
  peers: [],
  projectLabels: [],
  commentRevision: 0,
  readOnly: false,
  onClose: vi.fn(),
  onSaved: vi.fn(),
  onDeleted: vi.fn(),
  onLabelsSaved: vi.fn(),
};

it("keeps independent forms and saves a conflict only after an explicit overwrite", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: { details: { current: { ...task, updated_at: "2026-09-02T00:00:00Z" } } },
      }),
    })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: task }) });
  vi.stubGlobal("fetch", fetchMock);
  const { container } = render(<TaskDetailDrawer {...props} />);
  expect(container.ownerDocument.querySelector("form form")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("This task changed since you opened it.");
  expect(props.onSaved).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Overwrite with mine" }));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(task));
  expect(JSON.parse(fetchMock.mock.calls[2]![1].body).expectedUpdatedAt).toBe(
    "2026-09-02T00:00:00Z",
  );
});

it("supports Escape and prevents viewer mutations", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }));
  render(<TaskDetailDrawer {...props} readOnly />);
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  expect(screen.getByLabelText("Title")).toHaveAttribute("readonly");
  await userEvent.keyboard("{Escape}");
  expect(props.onClose).toHaveBeenCalled();
});

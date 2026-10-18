import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TaskAttachments } from "./task-attachments";

const upload = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ upload }) } }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  upload.mockReset();
});

const mine = {
  id: "a1",
  task_id: "t1",
  file_name: "spec.pdf",
  mime_type: "application/pdf",
  size_bytes: 2048,
  storage_path: "p/t1/a1.pdf",
  created_by: "u1",
  created_at: "2026-09-01T00:00:00Z",
};
const theirs = { ...mine, id: "a2", file_name: "mockup.png", created_by: "u2" };
const props = {
  taskId: "t1",
  currentUserId: "u1",
  currentUserRole: "member" as const,
  readOnly: false,
};

it("lists files with their size", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [mine, theirs] }) }),
  );
  render(<TaskAttachments {...props} />);
  expect(await screen.findByText("spec.pdf")).toBeInTheDocument();
  expect(screen.getAllByText("2 KB")).toHaveLength(2);
  expect(screen.getByText("mockup.png")).toBeInTheDocument();
});

it("lets members remove only their own files", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [mine, theirs] }) }),
  );
  render(<TaskAttachments {...props} />);
  await screen.findByText("mockup.png");
  expect(screen.getByRole("button", { name: "Remove spec.pdf" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove mockup.png" })).toBeNull();
});

it("hides upload controls for read-only viewers", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }));
  render(<TaskAttachments {...props} readOnly />);
  await screen.findByText(/Attach files to this task/);
  expect(screen.queryByLabelText("Choose files to attach")).toBeNull();
});

it("rejects a disallowed type before contacting the server", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<TaskAttachments {...props} />);
  const input = await screen.findByLabelText("Choose files to attach");
  await userEvent.upload(input, new File(["x"], "run.exe", { type: "application/x-msdownload" }), {
    applyAccept: false,
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(/not allowed/);
  expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial list request
});

it("registers a file, uploads the bytes, and reports the new count", async () => {
  const onCountChange = vi.fn();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: mine }) });
  vi.stubGlobal("fetch", fetchMock);
  upload.mockResolvedValue({ error: null });
  render(<TaskAttachments {...props} onCountChange={onCountChange} />);
  const input = await screen.findByLabelText("Choose files to attach");
  await userEvent.upload(input, new File(["%PDF"], "spec.pdf", { type: "application/pdf" }));
  expect(await screen.findByText("spec.pdf")).toBeInTheDocument();
  expect(upload).toHaveBeenCalledWith("p/t1/a1.pdf", expect.any(File), expect.anything());
  expect(onCountChange).toHaveBeenCalledWith(1);
});

it("unregisters the row when the storage upload fails", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: mine }) })
    .mockResolvedValueOnce({ ok: true, status: 204 });
  vi.stubGlobal("fetch", fetchMock);
  upload.mockResolvedValue({ error: { message: "boom" } });
  render(<TaskAttachments {...props} />);
  const input = await screen.findByLabelText("Choose files to attach");
  await userEvent.upload(input, new File(["%PDF"], "spec.pdf", { type: "application/pdf" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/could not be uploaded/);
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/v1/tasks/t1/attachments/a1",
    expect.objectContaining({ method: "DELETE" }),
  );
});

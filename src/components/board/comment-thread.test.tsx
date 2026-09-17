import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentThread } from "./comment-thread";

afterEach(() => vi.unstubAllGlobals());

const props = {
  taskId: "t1",
  projectId: "p1",
  currentUserId: "u1",
  currentUserRole: "member" as const,
  readOnly: false,
  peers: [],
};

describe("CommentThread", () => {
  it("loads and posts comments", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              {
                id: "c1",
                task_id: "t1",
                author_id: "u2",
                body: "Existing",
                mentioned_user_ids: [],
                created_at: "",
                updated_at: "",
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: {
              id: "c2",
              task_id: "t1",
              author_id: "u1",
              body: "New",
              mentioned_user_ids: [],
              created_at: "",
              updated_at: "",
            },
          }),
        }),
    );
    render(<CommentThread {...props} />);
    expect(await screen.findByText("Existing")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Add a comment" }), "New");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(await screen.findByText("New")).toBeInTheDocument();
  });

  it("preserves a failed submission draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: "No connection" } }),
        }),
    );
    render(<CommentThread {...props} />);
    const input = await screen.findByRole("textbox", { name: "Add a comment" });
    await userEvent.type(input, "Keep this");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No connection"));
    expect(input).toHaveValue("Keep this");
  });

  it("edits an authored comment with its current timestamp", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              {
                id: "c1",
                task_id: "t1",
                author_id: "u1",
                body: "Original",
                mentioned_user_ids: [],
                created_at: "",
                updated_at: "2026-09-20T00:00:00Z",
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: {
              id: "c1",
              task_id: "t1",
              author_id: "u1",
              body: "Edited",
              mentioned_user_ids: [],
              created_at: "",
              updated_at: "2026-09-20T00:01:00Z",
            },
          }),
        }),
    );
    render(<CommentThread {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const input = screen.getByRole("textbox", { name: "Edit comment" });
    await userEvent.clear(input);
    await userEvent.type(input, "Edited");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Edited")).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/v1/tasks/t1/comments/c1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TaskLinks } from "./task-links";

afterEach(() => vi.unstubAllGlobals());

const mine = {
  id: "l1",
  task_id: "t1",
  url: "https://docs.example.com/spec",
  title: null,
  created_by: "u1",
  created_at: "2026-09-01T00:00:00Z",
};
const theirs = {
  ...mine,
  id: "l2",
  url: "https://figma.com/file/1",
  title: "Mockups",
  created_by: "u2",
};
const props = {
  taskId: "t1",
  currentUserId: "u1",
  currentUserRole: "member" as const,
  readOnly: false,
};

it("opens links in a new tab and falls back to the hostname", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [mine, theirs] }) }),
  );
  render(<TaskLinks {...props} />);
  const fallback = await screen.findByRole("link", { name: /docs\.example\.com/ });
  expect(fallback).toHaveAttribute("href", "https://docs.example.com/spec");
  expect(fallback).toHaveAttribute("target", "_blank");
  expect(fallback).toHaveAttribute("rel", "noopener noreferrer");
  expect(screen.getByRole("link", { name: /Mockups/ })).toBeInTheDocument();
});

it("lets members remove only their own links", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [mine, theirs] }) }),
  );
  render(<TaskLinks {...props} />);
  await screen.findByRole("link", { name: /Mockups/ });
  expect(screen.getByRole("button", { name: "Remove docs.example.com" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove Mockups" })).toBeNull();
});

it("rejects a link without a scheme before sending it", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<TaskLinks {...props} />);
  await userEvent.type(await screen.findByLabelText("Link URL"), "example.com/doc");
  await userEvent.click(screen.getByRole("button", { name: "Add link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/http:\/\/ or https:\/\//);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("adds a link and reports the new count", async () => {
  const onCountChange = vi.fn();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [mine] }) })
    .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ data: theirs }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<TaskLinks {...props} onCountChange={onCountChange} />);
  await userEvent.type(await screen.findByLabelText("Link URL"), "https://figma.com/file/1");
  await userEvent.type(screen.getByLabelText("Link title (optional)"), "Mockups");
  await userEvent.click(screen.getByRole("button", { name: "Add link" }));
  await screen.findByRole("link", { name: /Mockups/ });
  expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({
    url: "https://figma.com/file/1",
    title: "Mockups",
  });
  await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(2));
});

it("shows links read-only to viewers", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [mine] }) }),
  );
  render(<TaskLinks {...props} currentUserRole="viewer" readOnly />);
  const list = await screen.findByRole("list", { name: "Links" });
  expect(within(list).getAllByRole("link")).toHaveLength(1);
  expect(screen.queryByLabelText("Link URL")).toBeNull();
  expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
});

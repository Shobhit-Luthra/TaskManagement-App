import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "./bell";

vi.mock("@/lib/realtime/use-notification-channel", () => ({
  useNotificationChannel: () => "connected",
}));

const NOTIFICATIONS = [
  {
    id: "n1",
    project_id: "p1",
    task_id: "t1",
    type: "task_assigned",
    payload: { taskTitle: "Ship it" },
    read_at: null,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "n2",
    project_id: "p1",
    task_id: null,
    type: "digest_ready",
    payload: {},
    read_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NotificationBell", () => {
  it("shows the unread count from the initial fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: NOTIFICATIONS }) }),
    );
    render(<NotificationBell userId="user-1" />);
    await waitFor(() =>
      expect(screen.getByLabelText("Notifications, 1 unread")).toBeInTheDocument(),
    );
  });

  it("caps the badge at 9+", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...NOTIFICATIONS[0],
      id: `n${i}`,
      read_at: null,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: many }) }),
    );
    render(<NotificationBell userId="user-1" />);
    await waitFor(() => expect(screen.getByText("9+")).toBeInTheDocument());
  });

  it("opens the list, marks all read, and clears the badge", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: NOTIFICATIONS }) }) // bell's own fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: NOTIFICATIONS }) }) // list's fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // read-all
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationBell userId="user-1" />);
    await waitFor(() =>
      expect(screen.getByLabelText("Notifications, 1 unread")).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByLabelText("Notifications, 1 unread"));
    await waitFor(() =>
      expect(screen.getByText('You were assigned "Ship it"')).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByText("Mark all read"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/notifications/read-all", { method: "POST" });
  });
});

it("retains unread state when marking a notification fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: NOTIFICATIONS }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: NOTIFICATIONS }) })
      .mockResolvedValueOnce({ ok: false, status: 500 }),
  );
  render(<NotificationBell userId="user-1" />);
  await userEvent.click(await screen.findByLabelText("Notifications, 1 unread"));
  await userEvent.click(await screen.findByRole("button", { name: /Mark as read:/ }));
  await screen.findByRole("alert");
  expect(screen.getByText("1 unread")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "Mentions" }));
  expect(screen.getByText("No mentions notifications.")).toBeInTheDocument();
});

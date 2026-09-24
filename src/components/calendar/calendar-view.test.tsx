import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarView } from "./calendar-view";

vi.mock("./use-calendar-tasks", async () => {
  const actual =
    await vi.importActual<typeof import("./use-calendar-tasks")>("./use-calendar-tasks");
  return {
    ...actual,
    useCalendarTasks: () => ({
      tasks: [],
      undated: [],
      loading: false,
      error: false,
      message: null,
      refresh: () => {},
      reschedule: async () => {},
    }),
  };
});

vi.mock("@/lib/realtime/use-project-channel", () => ({
  useProjectChannel: () => {},
}));

describe("CalendarView", () => {
  beforeEach(() => {
    // The browser's local zone (used when `timeZone` is UTC, mirroring the
    // My Tasks page) sees a different month than `initialAnchor`.
    vi.setSystemTime(new Date("2026-10-01T02:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-anchors to today's month after mount when the user has not navigated", async () => {
    render(
      <CalendarView
        source={{ kind: "me" }}
        initialAnchor="2026-09-24"
        timeZone="UTC"
        currentUserId="u1"
      />,
    );
    // Before the browser-zone "today" resolves, the server-computed anchor
    // is shown.
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("October 2026")).toBeInTheDocument());
  });
});

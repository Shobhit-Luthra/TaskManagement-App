import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let statusCallback: ((status: string) => void) | undefined;
  const removeChannel = vi.fn();
  const on = vi.fn();
  const subscribe = vi.fn((callback: (status: string) => void) => {
    statusCallback = callback;
    return channel;
  });
  const channel = { on, subscribe };
  on.mockImplementation(() => channel);
  const createClient = vi.fn(() => ({ channel: vi.fn(() => channel), removeChannel }));
  return {
    createClient,
    on,
    removeChannel,
    setStatus: (status: string) => statusCallback?.(status),
  };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));

import { useProjectChannel } from "./use-project-channel";

describe("useProjectChannel", () => {
  it("subscribes to both project tables, reports status, normalizes events, and cleans up", () => {
    const onTask = vi.fn();
    const onColumn = vi.fn();
    const { result, unmount } = renderHook(() =>
      useProjectChannel("project-1", { onTask, onColumn }),
    );

    expect(result.current).toBe("connecting");
    expect(mocks.on).toHaveBeenCalledTimes(2);
    expect(mocks.on.mock.calls[0]?.[1]).toMatchObject({
      table: "tasks",
      filter: "project_id=eq.project-1",
    });
    expect(mocks.on.mock.calls[1]?.[1]).toMatchObject({
      table: "columns",
      filter: "project_id=eq.project-1",
    });

    act(() => mocks.setStatus("SUBSCRIBED"));
    expect(result.current).toBe("connected");

    const taskCallback = mocks.on.mock.calls[0]?.[2] as (payload: unknown) => void;
    const columnCallback = mocks.on.mock.calls[1]?.[2] as (payload: unknown) => void;
    taskCallback({ eventType: "DELETE", old: { id: "task-1" } });
    columnCallback({ eventType: "INSERT", new: { id: "column-1" } });
    expect(onTask).toHaveBeenCalledWith({ type: "DELETE", old: { id: "task-1" } });
    expect(onColumn).toHaveBeenCalledWith({ type: "INSERT", row: { id: "column-1" } });

    act(() => mocks.setStatus("CHANNEL_ERROR"));
    expect(result.current).toBe("reconnecting");
    unmount();
    expect(mocks.removeChannel).toHaveBeenCalled();
  });
});

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

import { useNotificationChannel } from "./use-notification-channel";

describe("useNotificationChannel", () => {
  it("does nothing without a userId", () => {
    renderHook(() => useNotificationChannel(null, vi.fn()));
    expect(mocks.on).not.toHaveBeenCalled();
  });

  it("subscribes to the user's own notification inserts, reports status, and cleans up", () => {
    const onInsert = vi.fn();
    const { result, unmount } = renderHook(() => useNotificationChannel("user-1", onInsert));

    expect(result.current).toBe("connecting");
    expect(mocks.on).toHaveBeenCalledTimes(1);
    expect(mocks.on.mock.calls[0]?.[1]).toMatchObject({
      event: "INSERT",
      table: "notifications",
      filter: "user_id=eq.user-1",
    });

    act(() => mocks.setStatus("SUBSCRIBED"));
    expect(result.current).toBe("connected");

    const insertCallback = mocks.on.mock.calls[0]?.[2] as () => void;
    act(() => insertCallback());
    expect(onInsert).toHaveBeenCalledTimes(1);

    act(() => mocks.setStatus("CHANNEL_ERROR"));
    expect(result.current).toBe("reconnecting");

    unmount();
    expect(mocks.removeChannel).toHaveBeenCalled();
  });
});

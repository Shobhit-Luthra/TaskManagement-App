import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Announcer, type AnnouncerHandle } from "./announcer";

afterEach(() => vi.useRealTimers());

describe("Announcer", () => {
  it("updates its live region no more than once each second", () => {
    vi.useFakeTimers();
    const ref = createRef<AnnouncerHandle>();
    render(<Announcer ref={ref} />);
    act(() => ref.current?.announce("Task moved to Doing"));
    expect(screen.getByRole("status")).toHaveTextContent("Task moved to Doing");
    act(() => ref.current?.announce("Task moved to Done"));
    expect(screen.getByRole("status")).toHaveTextContent("Task moved to Doing");
    act(() => vi.advanceTimersByTime(1000));
    act(() => ref.current?.announce("Task moved to Done"));
    expect(screen.getByRole("status")).toHaveTextContent("Task moved to Done");
  });
});

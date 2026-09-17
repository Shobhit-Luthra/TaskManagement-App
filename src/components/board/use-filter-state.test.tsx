import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let currentSearch = "";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/p/proj-1/board",
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

describe("useFilterState", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    currentSearch = "";
    replace.mockReset();
    vi.useFakeTimers();
  });
  it("writes discrete filters immediately and debounces query text", async () => {
    const { useFilterState } = await import("./use-filter-state");
    const { result } = renderHook(() => useFilterState());
    act(() => result.current[1]({ priority: ["high"] }));
    expect(replace).toHaveBeenCalledWith("/p/proj-1/board?priority=high", { scroll: false });
    act(() => result.current[1]({ q: "bug" }));
    expect(replace).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(250));
    expect(replace).toHaveBeenLastCalledWith("/p/proj-1/board?priority=high&q=bug", {
      scroll: false,
    });
  });
  it("clears to the bare pathname", async () => {
    currentSearch = "priority=high";
    const { useFilterState } = await import("./use-filter-state");
    const { result } = renderHook(() => useFilterState());
    act(() => result.current[2]());
    expect(replace).toHaveBeenCalledWith("/p/proj-1/board", { scroll: false });
  });
  it("does not let a queued search overwrite a newer priority selection", async () => {
    const { useFilterState } = await import("./use-filter-state");
    const { result } = renderHook(() => useFilterState());
    act(() => result.current[1]({ q: "bug" }));
    act(() => result.current[1]({ priority: ["high"] }));
    act(() => vi.advanceTimersByTime(300));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenLastCalledWith("/p/proj-1/board?priority=high&q=bug", {
      scroll: false,
    });
  });
  it("reconciles navigation and cancels a search pending on the old URL", async () => {
    const { useFilterState } = await import("./use-filter-state");
    const { result, rerender } = renderHook(() => useFilterState());
    act(() => result.current[1]({ q: "old" }));
    currentSearch = "priority=low&task=t1";
    rerender();
    expect(result.current[0].priority).toEqual(["low"]);
    expect(result.current[0].q).toBe("");
    act(() => vi.advanceTimersByTime(300));
    expect(replace).not.toHaveBeenCalled();
    act(() => result.current[2]());
    expect(replace).toHaveBeenLastCalledWith("/p/proj-1/board?task=t1", { scroll: false });
  });
});

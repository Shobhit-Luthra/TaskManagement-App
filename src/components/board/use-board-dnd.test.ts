import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBoardDnd } from "./use-board-dnd";

const columns = [
  { id: "col-a", name: "To do", position: 1, wip_limit: null },
  { id: "col-b", name: "Doing", position: 2, wip_limit: null },
];
const tasks = [
  {
    id: "task-a",
    column_id: "col-a",
    title: "A",
    description: null,
    due_date: null,
    priority: "medium" as const,
    position: 1000,
    created_at: "",
    updated_at: "",
  },
];

describe("useBoardDnd", () => {
  it("moves a task to its dropped column with a fresh mutation id", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useBoardDnd({ tasks, columns, readOnly: false, onMove }));
    act(() =>
      result.current.onDragEnd({
        active: { id: "task-a" },
        over: { id: "col-b", data: { current: { type: "column", columnId: "col-b" } } },
      } as never),
    );
    expect(onMove).toHaveBeenCalledWith("task-a", "col-b", 1000, expect.any(String));
  });

  it("does not move from a read-only board", () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useBoardDnd({ tasks, columns, readOnly: true, onMove }));
    act(() =>
      result.current.onDragEnd({ active: { id: "task-a" }, over: { id: "col-b" } } as never),
    );
    expect(onMove).not.toHaveBeenCalled();
  });
});

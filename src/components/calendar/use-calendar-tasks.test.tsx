import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCalendarTasks, type CalendarTask } from "./use-calendar-tasks";

afterEach(() => vi.unstubAllGlobals());

const row: CalendarTask = {
  id: "t1",
  project_id: "p1",
  project_name: "Launch",
  title: "Write brief",
  description: null,
  due_date: "2026-09-24",
  priority: "medium",
  column_id: "c1",
  column_name: "To do",
  is_done: false,
  assignee_id: null,
  updated_at: "2026-09-01T00:00:00Z",
  can_edit: true,
  subtask_done: 0,
  subtask_total: 0,
};
const undatedRow: CalendarTask = { ...row, id: "t2", title: "Someday", due_date: null };
const source = { kind: "project", projectId: "p1" } as const;
const range = { from: "2026-08-31", to: "2026-10-11" };
const loaded = (rows: CalendarTask[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ data: rows }),
});

async function mount(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const hook = renderHook(() => useCalendarTasks(source, range));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("useCalendarTasks", () => {
  it("loads undated tasks on the first request and splits them out", async () => {
    const fetchMock = vi.fn().mockResolvedValue(loaded([row, undatedRow]));
    const { result } = await mount(fetchMock);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "/api/v1/projects/p1/calendar?from=2026-08-31&to=2026-10-11&undated=1",
    );
    expect(result.current.tasks.map((task) => task.id)).toEqual(["t1"]);
    expect(result.current.undated.map((task) => task.id)).toEqual(["t2"]);
  });

  it("does not show a task twice when a refresh finds it newly scheduled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loaded([row, undatedRow]))
      .mockResolvedValueOnce(loaded([row, { ...undatedRow, due_date: "2026-09-26" }]));
    const { result } = await mount(fetchMock);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.tasks).toHaveLength(2));
    expect(fetchMock.mock.calls[1]![0]).toBe(
      "/api/v1/projects/p1/calendar?from=2026-08-31&to=2026-10-11",
    );
    expect(result.current.undated).toEqual([]);
  });

  it("reschedules with the full task payload and the last seen version", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loaded([row]))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { ...row, due_date: "2026-09-30", updated_at: "2026-09-02T00:00:00Z" },
        }),
      });
    const { result } = await mount(fetchMock);
    await act(async () => {
      await result.current.reschedule("t1", "2026-09-30");
    });
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("/api/v1/tasks/t1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({
      title: "Write brief",
      description: null,
      priority: "medium",
      dueDate: "2026-09-30",
      assigneeId: null,
      expectedUpdatedAt: "2026-09-01T00:00:00Z",
    });
    expect(result.current.tasks[0]).toMatchObject({
      due_date: "2026-09-30",
      updated_at: "2026-09-02T00:00:00Z",
    });
  });

  it("shows the latest date after a conflict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loaded([row]))
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            details: {
              current: {
                ...row,
                title: "Renamed",
                assignee_id: "u2",
                due_date: "2026-09-25",
                updated_at: "2026-09-03T00:00:00Z",
              },
            },
          },
        }),
      });
    const { result } = await mount(fetchMock);
    await act(async () => {
      await result.current.reschedule("t1", "2026-09-30");
    });
    expect(result.current.tasks[0]).toMatchObject({
      title: "Renamed",
      assignee_id: "u2",
      due_date: "2026-09-25",
      updated_at: "2026-09-03T00:00:00Z",
    });
    expect(result.current.message).toMatch(/changed elsewhere/);

    const fetchMock2 = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: { ...row, due_date: "2026-09-26", updated_at: "2026-09-04T00:00:00Z" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock2);
    await act(async () => {
      await result.current.reschedule("t1", "2026-09-26");
    });
    const [, init] = fetchMock2.mock.calls[0]!;
    expect(JSON.parse(init.body)).toMatchObject({
      title: "Renamed",
      assigneeId: "u2",
      expectedUpdatedAt: "2026-09-03T00:00:00Z",
    });
  });

  it("returns an undated task to the tray when scheduling fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loaded([undatedRow]))
      .mockRejectedValueOnce(new Error("offline"));
    const { result } = await mount(fetchMock);
    await act(async () => {
      await result.current.reschedule("t2", "2026-09-26");
    });
    expect(result.current.tasks).toEqual([]);
    expect(result.current.undated.map((task) => task.id)).toEqual(["t2"]);
    expect(result.current.message).toMatch(/could not be changed/);
  });

  it("moves an undated task onto a day when scheduling succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loaded([undatedRow]))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { ...undatedRow, due_date: "2026-09-26", updated_at: "2026-09-02T00:00:00Z" },
        }),
      });
    const { result } = await mount(fetchMock);
    await act(async () => {
      await result.current.reschedule("t2", "2026-09-26");
    });
    expect(result.current.undated).toEqual([]);
    expect(result.current.tasks[0]).toMatchObject({ id: "t2", due_date: "2026-09-26" });
  });

  it("never sends a request for a task the caller cannot edit", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(loaded([{ ...row, can_edit: false }]));
    const { result } = await mount(fetchMock);
    await act(async () => {
      await result.current.reschedule("t1", "2026-09-30");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.tasks[0]!.due_date).toBe("2026-09-24");
  });

  it("does not clobber fields refreshed while a reschedule PATCH is in flight", async () => {
    let resolvePatch!: (value: unknown) => void;
    const patchPromise = new Promise((resolve) => {
      resolvePatch = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loaded([row]))
      .mockImplementationOnce(() => patchPromise)
      .mockResolvedValueOnce(loaded([{ ...row, title: "Renamed" }]));
    const { result } = await mount(fetchMock);

    let reschedulePromise!: Promise<void>;
    act(() => {
      reschedulePromise = result.current.reschedule("t1", "2026-09-30");
    });

    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.tasks[0]?.title).toBe("Renamed"));

    await act(async () => {
      resolvePatch({
        ok: true,
        status: 200,
        json: async () => ({
          data: { ...row, due_date: "2026-09-30", updated_at: "2026-09-02T00:00:00Z" },
        }),
      });
      await reschedulePromise;
    });

    expect(result.current.tasks[0]).toMatchObject({
      title: "Renamed",
      due_date: "2026-09-30",
    });
  });
});

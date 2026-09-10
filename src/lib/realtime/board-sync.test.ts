import { describe, expect, it } from "vitest";
import type { BoardColumn, BoardTask } from "@/components/board/project-board";
import { mergeColumnEvent, mergeTaskEvent, type ColumnRow, type TaskRow } from "./board-sync";

function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    project_id: "p1",
    column_id: "c1",
    title: "Ship it",
    description: null,
    due_date: null,
    priority: "medium",
    position: 1,
    mutation_id: null,
    deleted_at: null,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    ...overrides,
  };
}

function boardTask(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    column_id: "c1",
    title: "Ship it",
    description: null,
    due_date: null,
    priority: "medium",
    position: 1,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    ...overrides,
  };
}

describe("mergeTaskEvent", () => {
  it("appends a task on INSERT", () => {
    const result = mergeTaskEvent(
      [],
      { type: "INSERT", row: taskRow({ title: "New" }) },
      new Set(),
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.title).toBe("New");
  });

  it("ignores an INSERT for an already-known task", () => {
    const existing = [boardTask()];
    const result = mergeTaskEvent(existing, { type: "INSERT", row: taskRow() }, new Set());
    expect(result.tasks).toBe(existing);
  });

  it("ignores an INSERT for a soft-deleted row", () => {
    const result = mergeTaskEvent(
      [],
      { type: "INSERT", row: taskRow({ deleted_at: "2026-09-10T01:00:00Z" }) },
      new Set(),
    );
    expect(result.tasks).toHaveLength(0);
  });

  it("replaces a task by id on UPDATE", () => {
    const result = mergeTaskEvent(
      [boardTask()],
      { type: "UPDATE", row: taskRow({ column_id: "c2", position: 5 }) },
      new Set(),
    );
    expect(result.tasks[0]?.column_id).toBe("c2");
    expect(result.tasks[0]?.position).toBe(5);
  });

  it("removes a task when an UPDATE carries a deleted_at", () => {
    const result = mergeTaskEvent(
      [boardTask()],
      { type: "UPDATE", row: taskRow({ deleted_at: "2026-09-10T02:00:00Z" }) },
      new Set(),
    );
    expect(result.tasks).toHaveLength(0);
  });

  it("suppresses an UPDATE echo for an in-flight mutation and reports it consumed", () => {
    const existing = [boardTask()];
    const result = mergeTaskEvent(
      existing,
      { type: "UPDATE", row: taskRow({ column_id: "c2", mutation_id: "m-1" }) },
      new Set(["m-1"]),
    );
    expect(result.tasks).toBe(existing);
    expect(result.consumedMutationId).toBe("m-1");
  });

  it("removes a task by id on DELETE", () => {
    const result = mergeTaskEvent(
      [boardTask(), boardTask({ id: "22222222-2222-2222-2222-222222222222" })],
      { type: "DELETE", old: { id: "11111111-1111-1111-1111-111111111111" } },
      new Set(),
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.id).toBe("22222222-2222-2222-2222-222222222222");
  });
});

describe("mergeColumnEvent", () => {
  const column = (overrides: Partial<ColumnRow> = {}): ColumnRow => ({
    id: "c1",
    project_id: "p1",
    name: "To Do",
    position: 1,
    wip_limit: null,
    deleted_at: null,
    ...overrides,
  });

  it("inserts a column and keeps the list ordered by position", () => {
    const existing: BoardColumn[] = [{ id: "c2", name: "Done", position: 2, wip_limit: null }];
    const result = mergeColumnEvent(existing, { type: "INSERT", row: column() });
    expect(result.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("drops a column when an UPDATE carries a deleted_at", () => {
    const existing: BoardColumn[] = [{ id: "c1", name: "To Do", position: 1, wip_limit: null }];
    const result = mergeColumnEvent(existing, {
      type: "UPDATE",
      row: column({ deleted_at: "2026-09-10T00:00:00Z" }),
    });
    expect(result).toHaveLength(0);
  });
});

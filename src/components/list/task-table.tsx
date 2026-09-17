"use client";

import { useRef, useState } from "react";
import type { BoardColumn, BoardTask } from "@/components/board/project-board";
import type { PeerOption } from "@/components/board/mention-autocomplete";
import { LabelChip } from "@/components/labels/label-chip";

export type InlineTaskPatch = {
  assigneeId?: string | null;
  dueDate?: string | null;
  priority?: BoardTask["priority"];
};
type SortKey = "title" | "column" | "assignee" | "priority" | "due";

export function TaskTable({
  tasks,
  columns,
  peers,
  readOnly,
  onInlineUpdate,
  onOpenTask,
}: {
  tasks: BoardTask[];
  columns: BoardColumn[];
  peers: PeerOption[];
  readOnly: boolean;
  onInlineUpdate: (taskId: string, patch: InlineTaskPatch) => Promise<void>;
  onOpenTask: (task: BoardTask) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({
    key: "title",
    ascending: true,
  });
  const [pending, setPending] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const columnName = (task: BoardTask) =>
    columns.find((column) => column.id === task.column_id)?.name ?? "Unknown column";
  const assigneeName = (task: BoardTask) =>
    peers.find((peer) => peer.userId === task.assignee_id)?.displayName ?? "Unassigned";
  function value(task: BoardTask): string | number {
    if (sort.key === "column") return columnName(task);
    if (sort.key === "assignee") return assigneeName(task);
    if (sort.key === "priority") return ["low", "medium", "high", "urgent"].indexOf(task.priority);
    if (sort.key === "due") return task.due_date ?? "9999-12-31";
    return task.title;
  }
  const sorted = [...tasks].sort((a, b) => {
    const av = value(a),
      bv = value(b);
    const comparison =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
    return (sort.ascending ? comparison : -comparison) || a.id.localeCompare(b.id);
  });
  async function update(task: BoardTask, patch: InlineTaskPatch) {
    if (readOnly || inFlight.current) return;
    inFlight.current = true;
    setPending(task.id);
    setError(null);
    try {
      await onInlineUpdate(task.id, patch);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Changes could not be saved. Try again.");
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }
  return (
    <div>
      {error && (
        <p role="alert" className="text-destructive my-3 text-sm">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <caption className="sr-only">
            Tasks. Use column headings to change the sort order.
          </caption>
          <thead className="bg-muted/50 border-b">
            <tr>
              {(
                [
                  ["title", "Task"],
                  ["column", "Column"],
                  ["assignee", "Assignee"],
                  ["priority", "Priority"],
                  ["due", "Due date"],
                ] as const
              ).map(([key, label]) => (
                <th
                  key={key}
                  scope="col"
                  aria-sort={
                    sort.key === key ? (sort.ascending ? "ascending" : "descending") : "none"
                  }
                  className="px-4 py-3"
                >
                  <button
                    type="button"
                    className="underline-offset-4 hover:underline focus-visible:outline-2"
                    onClick={() =>
                      setSort({ key, ascending: sort.key === key ? !sort.ascending : true })
                    }
                  >
                    {label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.map((task) => (
              <tr key={task.id} aria-busy={pending === task.id}>
                <td className="max-w-sm px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onOpenTask(task)}
                    className="text-left font-medium break-words hover:underline"
                  >
                    {task.title}
                  </button>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {task.labels?.map((label) => (
                      <LabelChip key={label.id} name={label.name} color={label.color} />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">{columnName(task)}</td>
                <td className="px-4 py-3">
                  {readOnly ? (
                    assigneeName(task)
                  ) : (
                    <select
                      aria-label={`Assignee for ${task.title}`}
                      value={task.assignee_id ?? ""}
                      disabled={pending !== null}
                      onChange={(event) =>
                        void update(task, { assigneeId: event.target.value || null })
                      }
                      className="bg-background max-w-48 rounded border p-2"
                    >
                      <option value="">Unassigned</option>
                      {peers.map((peer) => (
                        <option key={peer.userId} value={peer.userId}>
                          {peer.displayName}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-4 py-3">
                  {readOnly ? (
                    <span className="capitalize">{task.priority}</span>
                  ) : (
                    <select
                      aria-label={`Priority for ${task.title}`}
                      value={task.priority}
                      disabled={pending !== null}
                      onChange={(event) =>
                        void update(task, { priority: event.target.value as BoardTask["priority"] })
                      }
                      className="bg-background rounded border p-2"
                    >
                      {["low", "medium", "high", "urgent"].map((priority) => (
                        <option key={priority} value={priority}>
                          {priority}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-4 py-3">
                  {readOnly ? (
                    (task.due_date ?? "No due date")
                  ) : (
                    <input
                      type="date"
                      aria-label={`Due date for ${task.title}`}
                      value={task.due_date ?? ""}
                      disabled={pending !== null}
                      onChange={(event) =>
                        void update(task, { dueDate: event.target.value || null })
                      }
                      className="bg-background rounded border p-2"
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tasks.length === 0 && (
        <p className="text-muted-foreground p-6 text-center text-sm">
          No matching tasks. Try changing or clearing the filters.
        </p>
      )}
    </div>
  );
}

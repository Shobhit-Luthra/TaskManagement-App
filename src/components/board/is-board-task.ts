import type { BoardTask } from "./project-board";

export function isBoardTask(value: unknown): value is { data: BoardTask } {
  if (typeof value !== "object" || value === null || !("data" in value)) return false;
  const task = value.data;
  return (
    typeof task === "object" &&
    task !== null &&
    "id" in task &&
    typeof task.id === "string" &&
    "column_id" in task
  );
}

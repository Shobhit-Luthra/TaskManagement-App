import type { BoardColumn, BoardTask } from "@/components/board/project-board";

export type TaskRow = {
  id: string;
  project_id: string;
  column_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: BoardTask["priority"];
  position: number;
  mutation_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ColumnRow = {
  id: string;
  project_id: string;
  name: string;
  position: number;
  wip_limit: number | null;
  deleted_at: string | null;
};

export type ChangeEvent<Row> =
  | { type: "INSERT"; row: Row }
  | { type: "UPDATE"; row: Row }
  | { type: "DELETE"; old: { id?: string } };

/** Time a task move keeps its mutation id in the in-flight set before we stop
 *  suppressing its echo, in case the realtime event never arrives. */
export const MUTATION_ECHO_TTL_MS = 10_000;

/** Grace period after a dropped realtime connection before the board goes
 *  read-only (system design §264). */
export const SYNC_GRACE_MS = 30_000;

function toBoardTask(row: TaskRow): BoardTask {
  return {
    id: row.id,
    column_id: row.column_id,
    title: row.title,
    description: row.description,
    due_date: row.due_date,
    priority: row.priority,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export type TaskMergeResult = {
  tasks: BoardTask[];
  /** Set when the event was this client's own echo and was not re-applied. */
  consumedMutationId?: string;
};

export function mergeTaskEvent(
  tasks: BoardTask[],
  event: ChangeEvent<TaskRow>,
  inFlightMutations: ReadonlySet<string>,
): TaskMergeResult {
  if (event.type === "DELETE") {
    const id = event.old.id;
    if (!id) return { tasks };
    const next = tasks.filter((task) => task.id !== id);
    return { tasks: next.length === tasks.length ? tasks : next };
  }

  const { row } = event;

  if (row.mutation_id && inFlightMutations.has(row.mutation_id)) {
    return { tasks, consumedMutationId: row.mutation_id };
  }

  const known = tasks.some((task) => task.id === row.id);

  if (row.deleted_at) {
    if (!known) return { tasks };
    return { tasks: tasks.filter((task) => task.id !== row.id) };
  }

  if (event.type === "INSERT") {
    if (known) return { tasks };
    return { tasks: [...tasks, toBoardTask(row)] };
  }

  // UPDATE
  if (!known) return { tasks: [...tasks, toBoardTask(row)] };
  return {
    tasks: tasks.map((task) => (task.id === row.id ? toBoardTask(row) : task)),
  };
}

function toBoardColumn(row: ColumnRow): BoardColumn {
  return { id: row.id, name: row.name, position: row.position, wip_limit: row.wip_limit };
}

export function mergeColumnEvent(
  columns: BoardColumn[],
  event: ChangeEvent<ColumnRow>,
): BoardColumn[] {
  const byPosition = (list: BoardColumn[]) =>
    [...list].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  if (event.type === "DELETE") {
    const id = event.old.id;
    return id ? columns.filter((column) => column.id !== id) : columns;
  }

  const { row } = event;
  const without = columns.filter((column) => column.id !== row.id);
  if (row.deleted_at) return without;
  return byPosition([...without, toBoardColumn(row)]);
}

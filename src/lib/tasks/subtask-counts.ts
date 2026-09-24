export function subtaskCounts(rows: { is_completed: boolean }[] | null | undefined): {
  subtask_done: number;
  subtask_total: number;
} {
  const list = rows ?? [];
  return {
    subtask_done: list.filter((row) => row.is_completed).length,
    subtask_total: list.length,
  };
}

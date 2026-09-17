import type { FilterState } from "./schema";
import { addDaysToDateString, todayInTimeZone } from "./timezone";

export type FilterableTask = {
  id: string;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  due_date: string | null;
  assignee_id: string | null;
  label_ids: string[];
  isDone: boolean;
};

function matchesDue(task: FilterableTask, due: NonNullable<FilterState["due"]>, today: string) {
  if (due === "none") return task.due_date === null;
  if (!task.due_date) return false;
  if (due === "overdue") return task.due_date < today && !task.isDone;
  if (due === "today") return task.due_date === today;
  return task.due_date >= today && task.due_date <= addDaysToDateString(today, 7);
}

export function applyFilters<T extends FilterableTask>(
  tasks: T[],
  filters: FilterState,
  ctx: { projectTimezone: string; now: Date },
): T[] {
  const today = todayInTimeZone(ctx.now, ctx.projectTimezone);
  const query = filters.q.trim().toLowerCase();
  return tasks.filter((task) => {
    if (
      filters.assignee.length &&
      (!task.assignee_id || !filters.assignee.includes(task.assignee_id))
    )
      return false;
    if (filters.label.length && !task.label_ids.some((id) => filters.label.includes(id)))
      return false;
    if (filters.priority.length && !filters.priority.includes(task.priority)) return false;
    if (filters.due && !matchesDue(task, filters.due, today)) return false;
    return !query || `${task.title} ${task.description ?? ""}`.toLowerCase().includes(query);
  });
}

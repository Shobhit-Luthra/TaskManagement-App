import { addDaysToDateString, todayInTimeZone } from "@/lib/filters/timezone";

export type DueGroup = "overdue" | "today" | "week" | "later" | "none";
export type MyTask = {
  id: string;
  title: string;
  priority: "low" | "medium" | "high" | "urgent";
  due_date: string | null;
  isDone: boolean;
  projectId: string;
  projectName: string;
  projectTimezone: string;
  columnName: string;
};

export function groupByDueState(tasks: MyTask[], now: Date): Record<DueGroup, MyTask[]> {
  const groups: Record<DueGroup, MyTask[]> = {
    overdue: [],
    today: [],
    week: [],
    later: [],
    none: [],
  };
  for (const task of tasks) {
    if (task.isDone) continue;
    const today = todayInTimeZone(now, task.projectTimezone);
    if (!task.due_date) groups.none.push(task);
    else if (task.due_date < today) groups.overdue.push(task);
    else if (task.due_date === today) groups.today.push(task);
    else if (task.due_date <= addDaysToDateString(today, 7)) groups.week.push(task);
    else groups.later.push(task);
  }
  return groups;
}

export type CalendarView = "month" | "week";
export const MAX_CHIPS_PER_DAY = 3;

function parts(date: string): [number, number, number] {
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  return [year, month, day];
}

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = parts(date);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return toDateString(value);
}

export function startOfWeek(date: string): string {
  const [year, month, day] = parts(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function visibleDays(view: CalendarView, anchor: string): string[] {
  const start = startOfWeek(view === "month" ? firstOfMonth(anchor) : anchor);
  const count = view === "month" ? 42 : 7;
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

export function visibleRange(view: CalendarView, anchor: string): { from: string; to: string } {
  const days = visibleDays(view, anchor);
  return { from: days[0]!, to: days[days.length - 1]! };
}

export function shiftAnchor(view: CalendarView, anchor: string, direction: -1 | 1): string {
  if (view === "week") return addDays(anchor, 7 * direction);
  const [year, month] = parts(anchor);
  return toDateString(new Date(Date.UTC(year, month - 1 + direction, 1)));
}

export function groupByDueDate<T extends { due_date: string | null }>(
  tasks: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const task of tasks) {
    if (!task.due_date) continue;
    groups.set(task.due_date, [...(groups.get(task.due_date) ?? []), task]);
  }
  return groups;
}

export function monthLabel(anchor: string): string {
  const [year, month] = parts(anchor);
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

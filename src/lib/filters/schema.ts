import { z } from "zod";

export const dueFilterSchema = z.enum(["overdue", "today", "week", "none"]);
export type DueFilter = z.infer<typeof dueFilterSchema>;
const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);
type Priority = z.infer<typeof prioritySchema>;
const identifierSchema = z.string().min(1).max(100);

export type FilterState = {
  assignee: string[];
  label: string[];
  priority: Priority[];
  due: DueFilter | null;
  q: string;
};
export const EMPTY_FILTER_STATE: FilterState = {
  assignee: [],
  label: [],
  priority: [],
  due: null,
  q: "",
};

function splitCsv(value: string | null) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 50);
}

export function parseFilterState(searchParams: URLSearchParams): FilterState {
  const assignee = splitCsv(searchParams.get("assignee")).filter(
    (value) => identifierSchema.safeParse(value).success,
  );
  const label = splitCsv(searchParams.get("label")).filter(
    (value) => identifierSchema.safeParse(value).success,
  );
  const priority = splitCsv(searchParams.get("priority")).filter(
    (value): value is Priority => prioritySchema.safeParse(value).success,
  );
  const rawDue = searchParams.get("due");
  const due = rawDue && dueFilterSchema.safeParse(rawDue).success ? (rawDue as DueFilter) : null;
  return { assignee, label, priority, due, q: (searchParams.get("q") ?? "").trim().slice(0, 200) };
}

export function serializeFilterState(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.assignee.length) params.set("assignee", state.assignee.join(","));
  if (state.label.length) params.set("label", state.label.join(","));
  if (state.priority.length) params.set("priority", state.priority.join(","));
  if (state.due) params.set("due", state.due);
  if (state.q.trim()) params.set("q", state.q.trim());
  return params;
}

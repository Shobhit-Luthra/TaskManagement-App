"use client";

import Link from "next/link";
import { Flag } from "lucide-react";
import { groupByDueState, type DueGroup, type MyTask } from "@/lib/my-tasks/group";

const labels: Record<DueGroup, string> = {
  overdue: "Overdue",
  today: "Due today",
  week: "Due this week",
  later: "Later",
  none: "No due date",
};
const order: DueGroup[] = ["overdue", "today", "week", "later", "none"];

export function MyTasksList({ tasks, now }: { tasks: MyTask[]; now: Date }) {
  const groups = groupByDueState(tasks, now);
  if (order.every((group) => groups[group].length === 0))
    return (
      <section className="bg-card mt-10 rounded-xl border border-dashed p-8 text-center">
        <h2 className="font-semibold">Nothing assigned to you</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Open tasks assigned to you across every project will show up here.
        </p>
      </section>
    );
  return (
    <div className="mt-8 space-y-8">
      {order
        .filter((group) => groups[group].length)
        .map((group) => (
          <section key={group} aria-labelledby={`my-tasks-${group}`}>
            <h2 id={`my-tasks-${group}`} className="text-sm font-semibold tracking-wide uppercase">
              {labels[group]}{" "}
              <span className="text-muted-foreground font-normal">({groups[group].length})</span>
            </h2>
            <ul className="mt-2 divide-y rounded-lg border">
              {groups[group].map((task) => (
                <li key={task.id}>
                  <Link
                    href={`/p/${task.projectId}/board?task=${task.id}`}
                    className="hover:bg-muted/40 flex items-center justify-between gap-3 px-4 py-3 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {task.projectName} · {task.columnName}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs capitalize">
                      <Flag className="size-3" aria-hidden="true" />
                      {task.priority}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

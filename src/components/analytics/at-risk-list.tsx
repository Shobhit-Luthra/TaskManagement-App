import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";

export type AtRiskTask = {
  taskId: string;
  title: string;
  dueDate: string;
  priority: string;
  columnName: string;
  assigneeName: string | null;
  isOverdue: boolean;
  daysUntilDue: number;
};

export function dueLabel(task: Pick<AtRiskTask, "isOverdue" | "daysUntilDue">): string {
  if (task.isOverdue) {
    const days = Math.abs(task.daysUntilDue);
    return `Overdue by ${days} ${days === 1 ? "day" : "days"}`;
  }
  if (task.daysUntilDue === 0) return "Due today";
  if (task.daysUntilDue === 1) return "Due tomorrow";
  return `Due in ${task.daysUntilDue} days`;
}

export function AtRiskList({ projectId, tasks }: { projectId: string; tasks: AtRiskTask[] }) {
  const overdue = tasks.filter((task) => task.isOverdue).length;
  return (
    <section aria-labelledby="at-risk-heading" className="bg-card rounded-xl border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="at-risk-heading" className="text-sm font-semibold">
          Overdue and at risk
        </h2>
        <p className="text-muted-foreground text-sm">
          {overdue} overdue · {tasks.length - overdue} due within 3 days
        </p>
      </div>
      {tasks.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">
          Nothing is overdue or due in the next 3 days.
        </p>
      ) : (
        <ul className="mt-3 divide-y">
          {tasks.map((task) => (
            <li key={task.taskId}>
              <Link
                href={`/p/${projectId}/board?task=${task.taskId}`}
                className="hover:bg-muted focus-visible:ring-ring -mx-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-2 py-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                <span
                  className={
                    task.isOverdue
                      ? "text-destructive inline-flex w-40 shrink-0 items-center gap-1.5 font-medium"
                      : "inline-flex w-40 shrink-0 items-center gap-1.5 font-medium text-[var(--status-amber-fg)]"
                  }
                >
                  {task.isOverdue ? (
                    <AlertTriangle className="size-4" aria-hidden="true" />
                  ) : (
                    <Clock className="size-4" aria-hidden="true" />
                  )}
                  {dueLabel(task)}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
                <span className="text-muted-foreground text-xs">
                  {task.columnName} · <span className="capitalize">{task.priority}</span> ·{" "}
                  {task.assigneeName ?? "Unassigned"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

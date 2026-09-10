import Link from "next/link";
import { ArrowLeft, LayoutList } from "lucide-react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type Task = {
  id: string;
  title: string;
  column_id: string;
  due_date: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  position: number;
};

type Column = { id: string; name: string };

export default async function ListPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!project) notFound();
  const [{ data: taskData, error: tasksError }, { data: columnData, error: columnsError }] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("id, title, column_id, due_date, priority, position")
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .order("position"),
      supabase
        .from("columns")
        .select("id, name")
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .order("position"),
    ]);
  const tasks = (taskData ?? []) as Task[];
  const columnNames = new Map(
    ((columnData ?? []) as Column[]).map((column) => [column.id, column.name]),
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link
        href={`/p/${projectId}/board`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm"
      >
        <ArrowLeft className="size-4" /> Back to board
      </Link>
      <div className="mt-6 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="bg-muted rounded-lg p-2.5">
            <LayoutList className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Task list</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {project.name} · {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
            </p>
          </div>
        </div>
        <Link
          href={`/p/${projectId}/board`}
          className="text-muted-foreground hover:text-foreground text-sm font-medium"
        >
          Board view
        </Link>
      </div>
      {tasksError || columnsError ? (
        <p className="text-destructive mt-10 text-sm" role="alert">
          Tasks could not be loaded. Refresh to try again.
        </p>
      ) : tasks.length === 0 ? (
        <section className="mt-10 rounded-xl border border-dashed p-8 text-center">
          <h2 className="font-semibold">No tasks yet</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Create your first task from the board.
          </p>
          <Link
            href={`/p/${projectId}/board`}
            className="mt-4 inline-flex text-sm font-medium underline underline-offset-4"
          >
            Open board
          </Link>
        </section>
      ) : (
        <div className="bg-card mt-10 overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground border-b text-xs font-medium">
                <tr>
                  <th className="px-4 py-3">Task</th>
                  <th className="px-4 py-3">Column</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Due date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tasks.map((task) => (
                  <tr key={task.id} className="hover:bg-muted/30">
                    <td className="max-w-md px-4 py-3 font-medium">
                      <Link href={`/p/${projectId}/board`} className="line-clamp-1 hover:underline">
                        {task.title}
                      </Link>
                    </td>
                    <td className="text-muted-foreground px-4 py-3">
                      {columnNames.get(task.column_id) ?? "Unknown column"}
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={task.priority} />
                    </td>
                    <td className="text-muted-foreground px-4 py-3">
                      {task.due_date
                        ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                            new Date(`${task.due_date}T00:00:00`),
                          )
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

function PriorityBadge({ priority }: { priority: Task["priority"] }) {
  const tone = {
    low: "border-slate-300 text-slate-700",
    medium: "border-blue-300 text-blue-700",
    high: "border-amber-300 text-amber-800",
    urgent: "border-red-300 text-red-700",
  }[priority];
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${tone}`}
    >
      {priority}
    </span>
  );
}

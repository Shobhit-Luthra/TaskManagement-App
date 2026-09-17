import { redirect } from "next/navigation";
import { MyTasksList } from "@/components/my-tasks/my-tasks-list";
import type { MyTask } from "@/lib/my-tasks/group";
import { createClient } from "@/lib/supabase/server";

export default async function MyTasksPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, priority, due_date, columns!inner(name, is_done_column), projects!inner(id, name, timezone)",
    )
    .eq("assignee_id", auth.user.id)
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false });
  const tasks: MyTask[] = (data ?? []).map((row) => {
    const column = Array.isArray(row.columns) ? row.columns[0] : row.columns;
    const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    return {
      id: row.id,
      title: row.title,
      priority: row.priority,
      due_date: row.due_date,
      isDone: column?.is_done_column ?? false,
      projectId: project?.id ?? "",
      projectName: project?.name ?? "Unknown project",
      projectTimezone: project?.timezone ?? "UTC",
      columnName: column?.name ?? "Unknown column",
    };
  });
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">My Tasks</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Open tasks assigned to you, across every project.
      </p>
      {error ? (
        <p role="alert" className="text-destructive mt-10 text-sm">
          Your tasks could not be loaded. Refresh to try again.
        </p>
      ) : (
        <MyTasksList tasks={tasks} now={new Date()} />
      )}
    </main>
  );
}

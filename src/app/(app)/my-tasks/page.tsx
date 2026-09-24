import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarView } from "@/components/calendar/calendar-view";
import { MyTasksList } from "@/components/my-tasks/my-tasks-list";
import { todayInTimeZone } from "@/lib/filters/timezone";
import type { MyTask } from "@/lib/my-tasks/group";
import { createClient } from "@/lib/supabase/server";

export default async function MyTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const showCalendar = view === "calendar";
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, priority, due_date, columns!inner(name, is_done_column, projects!inner(id, name, timezone))",
    )
    .eq("assignee_id", auth.user.id)
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false });
  const tasks: MyTask[] = (data ?? []).map((row) => {
    const column = Array.isArray(row.columns) ? row.columns[0] : row.columns;
    const project = Array.isArray(column?.projects) ? column.projects[0] : column?.projects;
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
    <main className={`mx-auto px-4 py-8 sm:px-6 ${showCalendar ? "max-w-6xl" : "max-w-4xl"}`}>
      <h1 className="text-headline-lg-mobile sm:text-headline-lg font-serif font-medium">
        My Tasks
      </h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Open tasks assigned to you, across every project.
      </p>
      <nav aria-label="My Tasks views" className="mt-4 flex gap-1">
        {[
          { label: "List", href: "/my-tasks", active: !showCalendar },
          { label: "Calendar", href: "/my-tasks?view=calendar", active: showCalendar },
        ].map((option) => (
          <Link
            key={option.label}
            href={option.href}
            aria-current={option.active ? "page" : undefined}
            className={
              option.active
                ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium"
                : "text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-sm font-medium"
            }
          >
            {option.label}
          </Link>
        ))}
      </nav>
      {showCalendar ? (
        <CalendarView
          source={{ kind: "me" }}
          initialAnchor={todayInTimeZone(new Date(), "UTC")}
          currentUserId={auth.user.id}
        />
      ) : error ? (
        <p role="alert" className="text-destructive mt-10 text-sm">
          Your tasks could not be loaded. Refresh to try again.
        </p>
      ) : (
        <MyTasksList tasks={tasks} now={new Date()} />
      )}
    </main>
  );
}

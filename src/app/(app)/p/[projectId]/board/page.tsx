import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectBoard, type BoardColumn, type BoardTask } from "@/components/board/project-board";
import { BoardHeaderInvite } from "@/components/members/board-header-invite";
import { createClient } from "@/lib/supabase/server";
import { subtaskCounts } from "@/lib/tasks/subtask-counts";

export default async function BoardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const [{ data: project }, { data: auth }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, timezone")
      .eq("id", projectId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if (!project || !auth.user) notFound();
  const [
    { data: columnData, error: columnsError },
    { data: taskData, error: tasksError },
    { data: membership },
    { data: memberData },
    { data: labelData },
  ] = await Promise.all([
    supabase
      .from("columns")
      .select("id, name, position, wip_limit, is_done_column")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("position"),
    supabase
      .from("tasks")
      .select(
        "id, column_id, title, description, due_date, priority, position, assignee_id, created_at, updated_at, task_labels(labels(id, name, color)), subtasks(is_completed)",
      )
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("position"),
    supabase
      .from("memberships")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id)
      .maybeSingle(),
    supabase
      .from("memberships")
      .select("user_id, project_peers!inner(id, display_name)")
      .eq("project_id", projectId),
    supabase.from("labels").select("id, name, color").eq("project_id", projectId).order("name"),
  ]);
  if (columnsError || tasksError) {
    return (
      <main className="text-destructive p-8 text-sm">
        The board could not be loaded. Refresh to try again.
      </main>
    );
  }
  const columns = (columnData ?? []) as BoardColumn[];
  const tasks = (taskData ?? []).map(({ subtasks, ...task }) => ({
    ...task,
    ...subtaskCounts(subtasks),
    labels: (task.task_labels ?? []).flatMap((taskLabel) => {
      const label = Array.isArray(taskLabel.labels) ? taskLabel.labels[0] : taskLabel.labels;
      return label ? [{ id: label.id, name: label.name, color: label.color }] : [];
    }),
  })) as BoardTask[];
  const members = (memberData ?? []).map((row) => {
    const peer = Array.isArray(row.project_peers) ? row.project_peers[0] : row.project_peers;
    return { userId: row.user_id, displayName: peer?.display_name ?? "Unknown" };
  });
  return (
    <main className="flex min-h-[calc(100dvh-88px)] flex-col">
      <header className="bg-background border-y px-4 py-4 sm:px-6">
        <Link
          href="/projects"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-3.5" /> Projects
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-headline-lg-mobile sm:text-headline-lg min-w-0 font-serif font-medium break-words">
            {project.name}
          </h1>
          <div className="flex items-center gap-3">
            <BoardHeaderInvite
              projectId={projectId}
              members={members}
              canInvite={membership?.role === "owner" || membership?.role === "admin"}
            />
            {membership?.role === "viewer" && (
              <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs font-medium">
                View only
              </span>
            )}
          </div>
        </div>
      </header>
      <ProjectBoard
        projectId={projectId}
        currentUserId={auth.user.id}
        initialColumns={columns}
        initialTasks={tasks}
        readOnly={membership?.role === "viewer"}
        currentUserRole={membership?.role ?? "viewer"}
        peers={members.map((member) => ({
          userId: member.userId,
          displayName: member.displayName,
        }))}
        projectLabels={labelData ?? []}
        projectTimezone={project.timezone}
      />
    </main>
  );
}

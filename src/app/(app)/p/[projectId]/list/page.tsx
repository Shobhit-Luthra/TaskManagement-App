import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectTaskList } from "@/components/list/project-task-list";
import type { BoardTask } from "@/components/board/project-board";

export default async function ListPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) notFound();
  const [projectResult, membershipResult, tasksResult, columnsResult, peersResult, labelsResult] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, timezone")
        .eq("id", projectId)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase
        .from("memberships")
        .select("role")
        .eq("project_id", projectId)
        .eq("user_id", auth.user.id)
        .maybeSingle(),
      supabase
        .from("tasks")
        .select(
          "id, title, description, column_id, due_date, priority, position, assignee_id, created_at, updated_at, task_labels(labels(id, name, color))",
        )
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .order("position"),
      supabase
        .from("columns")
        .select("id, name, position, wip_limit, is_done_column")
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .order("position"),
      supabase
        .from("memberships")
        .select("user_id, project_peers!inner(id, display_name)")
        .eq("project_id", projectId),
      supabase.from("labels").select("id, name, color").eq("project_id", projectId).order("name"),
    ]);
  const project = projectResult.data,
    membership = membershipResult.data;
  if (!project || !membership) notFound();
  const tasks = (tasksResult.data ?? []).map((task) => ({
    ...task,
    labels: (task.task_labels ?? []).flatMap((relation) => {
      const label = Array.isArray(relation.labels) ? relation.labels[0] : relation.labels;
      return label ? [label] : [];
    }),
  })) as BoardTask[];
  const peers = (peersResult.data ?? []).map((row) => {
    const peer = Array.isArray(row.project_peers) ? row.project_peers[0] : row.project_peers;
    return { userId: row.user_id, displayName: peer?.display_name ?? "Unknown member" };
  });
  const failed =
    tasksResult.error || columnsResult.error || peersResult.error || labelsResult.error;
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-headline-lg-mobile sm:text-headline-lg mt-6 font-serif font-medium">
        Task list
      </h1>
      <p className="text-muted-foreground mt-1 text-sm">{project.name}</p>
      {failed ? (
        <p role="alert" className="text-destructive mt-8 text-sm">
          Tasks could not be loaded. Refresh to try again.
        </p>
      ) : (
        <ProjectTaskList
          projectId={projectId}
          currentUserId={auth.user.id}
          initialTasks={tasks}
          initialColumns={columnsResult.data ?? []}
          peers={peers}
          labels={labelsResult.data ?? []}
          projectTimezone={project.timezone}
          currentUserRole={membership.role}
          readOnly={membership.role === "viewer"}
        />
      )}
    </main>
  );
}

import Link from "next/link";
import { Activity, ArrowLeft, LayoutList, Settings } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectBoard, type BoardColumn, type BoardTask } from "@/components/board/project-board";
import { createClient } from "@/lib/supabase/server";

export default async function BoardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const [{ data: project }, { data: auth }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
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
  ] = await Promise.all([
    supabase
      .from("columns")
      .select("id, name, position, wip_limit")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("position"),
    supabase
      .from("tasks")
      .select(
        "id, column_id, title, description, due_date, priority, position, created_at, updated_at",
      )
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("position"),
    supabase.from("memberships").select("role").eq("project_id", projectId).maybeSingle(),
  ]);
  if (columnsError || tasksError) {
    return (
      <main className="text-destructive p-8 text-sm">
        The board could not be loaded. Refresh to try again.
      </main>
    );
  }
  const columns = (columnData ?? []) as BoardColumn[];
  const tasks = (taskData ?? []) as BoardTask[];
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
          <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">
            {project.name}
          </h1>
          <div className="flex items-center gap-3">
            <Link
              href={`/p/${projectId}/list`}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
            >
              <LayoutList className="size-4" /> List
            </Link>
            {(membership?.role === "owner" || membership?.role === "admin") && (
              <Link
                href={`/p/${projectId}/settings`}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
              >
                <Settings className="size-4" /> Settings
              </Link>
            )}
            <Link
              href={`/p/${projectId}/activity`}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
            >
              <Activity className="size-4" /> Activity
            </Link>
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
      />
    </main>
  );
}

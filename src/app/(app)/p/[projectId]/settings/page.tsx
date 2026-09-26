import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectSettingsForm } from "@/components/projects/project-settings-form";
import { WorkflowSettings } from "@/components/projects/workflow-settings";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const [{ data: project }, { data: isAdmin }, { data: columns }, { count: pendingJoinRequests }] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, name, description, timezone")
        .eq("id", projectId)
        .is("deleted_at", null)
        .maybeSingle(),
      // Not a memberships query: RLS returns every member's row, so an
      // unfiltered maybeSingle() errors on any project with 2+ members.
      supabase.rpc("is_project_admin", { target_project: projectId }),
      supabase
        .from("columns")
        .select("id, name, position, wip_limit, is_done_column, is_in_progress_column")
        .eq("project_id", projectId)
        .is("deleted_at", null)
        .order("position"),
      // RLS shows admins every request for the project (and others only their own).
      supabase
        .from("join_requests")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("status", "pending"),
    ]);
  if (!project) notFound();
  const canManage = isAdmin === true;
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Link
        href={`/p/${projectId}/board`}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← Back to board
      </Link>
      <div className="mt-6 flex items-center justify-between">
        <div>
          <h1 className="text-headline-lg-mobile sm:text-headline-lg font-serif font-medium">
            Project settings
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Update the shared project details.</p>
        </div>
        <div className="flex gap-4">
          <Link
            href={`/p/${projectId}/settings/members`}
            className="text-muted-foreground hover:text-foreground text-sm font-medium"
          >
            Members
            {canManage && !!pendingJoinRequests && (
              <span className="bg-primary text-primary-foreground ml-1.5 rounded-full px-1.5 py-0.5 text-xs">
                {pendingJoinRequests}
                <span className="sr-only"> pending join requests</span>
              </span>
            )}{" "}
            →
          </Link>
          <Link
            href={`/p/${projectId}/settings/labels`}
            className="text-muted-foreground hover:text-foreground text-sm font-medium"
          >
            Labels →
          </Link>
        </div>
      </div>
      {canManage ? (
        <>
          <ProjectSettingsForm project={project} />
          <WorkflowSettings projectId={projectId} initialColumns={columns ?? []} />
        </>
      ) : (
        <p className="text-muted-foreground mt-8 rounded-lg border p-4 text-sm">
          Only project owners and admins can change these settings.
        </p>
      )}
    </main>
  );
}

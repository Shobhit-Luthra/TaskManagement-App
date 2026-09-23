import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectTimeline } from "@/components/timeline/project-timeline";

export default async function TimelinePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    { data: project },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);
  if (!user || !project) notFound();
  return (
    <main className="p-4 sm:p-7">
      <h1 className="text-headline-lg font-serif">Timeline</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        {project.name} · Tasks arranged by due date
      </p>
      <ProjectTimeline projectId={projectId} currentUserId={user.id} />
    </main>
  );
}

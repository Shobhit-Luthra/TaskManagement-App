import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { TrashList, type DeletedTask } from "@/components/board/trash-list";
import { createClient } from "@/lib/supabase/server";

export default async function TrashPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const [{ data: project }, { data: membership }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .eq("id", projectId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("memberships").select("role").eq("project_id", projectId).maybeSingle(),
  ]);
  if (!project || !membership || membership.role === "viewer") notFound();
  const { data: deletedTasks } = await supabase
    .from("tasks")
    .select("id, title, column_id, deleted_at")
    .eq("project_id", projectId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link
        href={`/p/${projectId}/board`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-3.5" /> Board
      </Link>
      <h1 className="text-headline-lg-mobile sm:text-headline-lg mt-2 font-serif font-medium">
        Trash
      </h1>
      <p className="text-muted-foreground mt-1 text-sm">Deleted tasks are kept for 30 days.</p>
      <TrashList initialTasks={(deletedTasks ?? []) as DeletedTask[]} />
    </main>
  );
}

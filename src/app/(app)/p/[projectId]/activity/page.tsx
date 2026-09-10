import Link from "next/link";
import { Activity, ArrowLeft, ClipboardList, FolderKanban, Pencil, Trash2 } from "lucide-react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type ActivityItem = {
  id: string;
  action: "created" | "updated" | "moved" | "completed" | "reopened" | "deleted";
  to_value: { title?: string; columnId?: string } | null;
  created_at: string;
  actor: { display_name: string }[] | null;
};

export default async function ActivityPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!project) notFound();

  const { data, error } = await supabase
    .from("activity")
    .select("id, action, to_value, created_at, actor:users(display_name)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(100);
  const items = (data ?? []) as ActivityItem[];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link
        href={`/p/${projectId}/board`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm"
      >
        <ArrowLeft className="size-4" /> Back to board
      </Link>
      <div className="mt-6 flex items-start gap-3">
        <div className="bg-muted rounded-lg p-2.5">
          <Activity className="size-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
          <p className="text-muted-foreground mt-1 text-sm">Recent work in {project.name}</p>
        </div>
      </div>
      {error ? (
        <p className="text-destructive mt-10 text-sm" role="alert">
          Activity could not be loaded. Refresh to try again.
        </p>
      ) : items.length === 0 ? (
        <section className="mt-10 rounded-xl border border-dashed p-8 text-center">
          <ClipboardList className="text-muted-foreground mx-auto size-7" aria-hidden="true" />
          <h2 className="mt-4 font-semibold">Nothing to report yet</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Task changes will appear here as your team works.
          </p>
        </section>
      ) : (
        <ol className="bg-card mt-10 divide-y rounded-xl border">
          {items.map((item) => (
            <li key={item.id} className="flex gap-3 p-4">
              <ActivityIcon action={item.action} />
              <div className="min-w-0 flex-1">
                <p className="text-sm">{describeActivity(item)}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  <time dateTime={item.created_at}>
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(item.created_at))}
                  </time>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function describeActivity(item: ActivityItem) {
  const actor = item.actor?.[0]?.display_name ?? "Someone";
  const title = item.to_value?.title ? `“${item.to_value.title}”` : "a task";
  const verb = {
    created: "created",
    updated: "updated",
    moved: "moved",
    completed: "completed",
    reopened: "reopened",
    deleted: "deleted",
  }[item.action];
  return (
    <>
      <span className="font-medium">{actor}</span> {verb} {title}.
    </>
  );
}

function ActivityIcon({ action }: { action: ActivityItem["action"] }) {
  const Icon = action === "deleted" ? Trash2 : action === "updated" ? Pencil : FolderKanban;
  return (
    <span className="bg-muted text-muted-foreground mt-0.5 rounded-md p-2">
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}

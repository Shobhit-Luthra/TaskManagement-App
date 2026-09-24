import { notFound } from "next/navigation";
import { CalendarView } from "@/components/calendar/calendar-view";
import { todayInTimeZone } from "@/lib/filters/timezone";
import { createClient } from "@/lib/supabase/server";

export default async function CalendarPage({ params }: { params: Promise<{ projectId: string }> }) {
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
      .select("name, timezone")
      .eq("id", projectId)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);
  if (!user || !project) notFound();
  return (
    <main className="p-4 sm:p-7">
      <h1 className="text-headline-lg font-serif">Calendar</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        {project.name} · Drag a task to another day to change its due date
      </p>
      <CalendarView
        source={{ kind: "project", projectId }}
        initialAnchor={todayInTimeZone(new Date(), project.timezone)}
        timeZone={project.timezone}
        currentUserId={user.id}
      />
    </main>
  );
}

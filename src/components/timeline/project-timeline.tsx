"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Calendar, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useProjectChannel } from "@/lib/realtime/use-project-channel";

type TimelineTask = {
  id: string;
  title: string;
  due_date: string | null;
  priority: string;
  column_name: string;
  is_done: boolean;
};
export function ProjectTimeline({
  projectId,
  currentUserId,
}: {
  projectId: string;
  currentUserId: string;
}) {
  const [tasks, setTasks] = useState<TimelineTask[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const router = useRouter();
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useProjectChannel(projectId, currentUserId, {
    onTask: refresh,
    onColumn: refresh,
    onMembershipRemoved: () => router.replace("/projects?removed=1"),
  });
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/projects/${projectId}/timeline`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Timeline unavailable");
        return response.json();
      })
      .then((body) => {
        if (!Array.isArray(body.data)) throw new Error("Invalid timeline response");
        if (!controller.signal.aborted) {
          setTasks(body.data);
          setError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, revision]);
  if (loading)
    return (
      <p role="status" className="text-muted-foreground py-10">
        Loading timeline…
      </p>
    );
  if (error)
    return (
      <div role="alert" className="py-10">
        <p>Timeline could not be loaded.</p>
        <Button variant="outline" onClick={refresh} className="mt-3">
          Try again
        </Button>
      </div>
    );
  const groups = new Map<string, TimelineTask[]>();
  for (const task of tasks) {
    const key = task.due_date ?? "Unscheduled";
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  if (!groups.has("Unscheduled")) groups.set("Unscheduled", []);
  return (
    <div className="mt-8 max-w-4xl space-y-8">
      {[...groups].map(([date, items]) => (
        <section
          key={date}
          aria-label={date === "Unscheduled" ? date : `Due ${date}`}
          className="grid gap-3 sm:grid-cols-[180px_1fr] sm:gap-8"
        >
          <h2 className="text-headline-md flex items-start gap-2 font-serif">
            <Calendar className="text-brand-primary mt-1 size-5 shrink-0" />
            {date === "Unscheduled"
              ? date
              : new Intl.DateTimeFormat(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${date}T12:00:00Z`))}
          </h2>
          <ul className="space-y-3">
            {items.length === 0 && (
              <li className="text-muted-foreground text-sm">No unscheduled tasks.</li>
            )}
            {items.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/p/${projectId}/board?task=${task.id}`}
                  className="bg-card hover:shadow-tier1 focus-visible:outline-ring block rounded-lg border p-4 transition-shadow"
                >
                  <div className="flex items-center gap-2">
                    {task.is_done && (
                      <CheckCircle2
                        aria-label="Completed"
                        className="text-status-completed-fg size-4"
                      />
                    )}
                    <span className="font-medium">{task.title}</span>
                  </div>
                  <div className="text-muted-foreground mt-2 flex gap-3 text-sm">
                    <span>{task.column_name}</span>
                    <span className="capitalize">{task.priority} priority</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

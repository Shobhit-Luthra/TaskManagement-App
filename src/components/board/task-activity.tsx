"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

type Activity = { id: string; action: string; created_at: string };

export function TaskActivity({ taskId, revision }: { taskId: string; revision: number }) {
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.resolve(
      createClient()
        .from("activity")
        .select("id, action, created_at")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false })
        .limit(50),
    )
      .then(({ data, error }) => {
        if (!active) return;
        setError(Boolean(error));
        setItems(data ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [taskId, revision, retry]);
  if (loading)
    return (
      <p role="status" className="text-muted-foreground py-4 text-sm">
        Loading activity…
      </p>
    );
  if (error)
    return (
      <div role="alert" className="py-4 text-sm">
        <p>Activity could not be loaded.</p>
        <Button variant="outline" className="mt-2" onClick={() => setRetry((value) => value + 1)}>
          Try again
        </Button>
      </div>
    );
  return (
    <ol className="divide-y">
      {items.length === 0 && (
        <li className="text-muted-foreground py-4 text-sm">No activity yet.</li>
      )}
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap justify-between gap-2 py-4 text-sm">
          <span className="capitalize">Task {item.action.replaceAll("_", " ")}</span>
          <time className="text-muted-foreground" dateTime={item.created_at}>
            {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(item.created_at),
            )}
          </time>
        </li>
      ))}
    </ol>
  );
}

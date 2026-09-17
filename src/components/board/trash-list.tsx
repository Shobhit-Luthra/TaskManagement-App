"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export type DeletedTask = { id: string; title: string; column_id: string; deleted_at: string };

export function TrashList({ initialTasks }: { initialTasks: DeletedTask[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore(taskId: string) {
    setError(null);
    setPendingId(taskId);
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/restore`, { method: "POST" });
      if (response.status === 410) {
        setTasks((current) => current.filter((task) => task.id !== taskId));
        setError("This task can no longer be restored because its 30-day retention period ended.");
        return;
      }
      if (!response.ok) throw new Error("restore rejected");
      setTasks((current) => current.filter((task) => task.id !== taskId));
    } catch {
      setError("Task could not be restored. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  if (tasks.length === 0)
    return <p className="text-muted-foreground mt-8 text-sm">Nothing in the trash.</p>;
  return (
    <section className="mt-6 space-y-3" aria-label="Deleted tasks">
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <ul className="divide-y overflow-hidden rounded-xl border">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{task.title}</p>
              <p className="text-muted-foreground text-xs">
                Deleted{" "}
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(task.deleted_at))}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={pendingId === task.id}
              onClick={() => void restore(task.id)}
            >
              {pendingId === task.id ? "Restoring" : "Restore"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

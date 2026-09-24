"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardTask } from "@/components/board/project-board";

export type CalendarTask = {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: BoardTask["priority"];
  column_id: string;
  column_name: string;
  is_done: boolean;
  assignee_id: string | null;
  updated_at: string;
  can_edit: boolean;
  subtask_done: number;
  subtask_total: number;
};

export type CalendarSource = { kind: "project"; projectId: string } | { kind: "me" };

type Versioned = Pick<CalendarTask, "due_date" | "updated_at">;
type SavePayload = { data?: Versioned; error?: { details?: { current?: Versioned } } };

export function calendarUrl(
  source: CalendarSource,
  range: { from: string; to: string },
  includeUndated: boolean,
): string {
  const base =
    source.kind === "project"
      ? `/api/v1/projects/${source.projectId}/calendar`
      : "/api/v1/me/calendar";
  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (includeUndated) params.set("undated", "1");
  return `${base}?${params}`;
}

export function useCalendarTasks(source: CalendarSource, range: { from: string; to: string }) {
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [undated, setUndated] = useState<CalendarTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const undatedLoaded = useRef(false);
  const pending = useRef(new Set<string>());
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const url = calendarUrl(source, range, false);

  useEffect(() => {
    const controller = new AbortController();
    const includeUndated = !undatedLoaded.current;
    void fetch(includeUndated ? `${url}&undated=1` : url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Calendar unavailable");
        return (await response.json()) as { data?: unknown };
      })
      .then((body) => {
        if (!Array.isArray(body.data)) throw new Error("Invalid calendar response");
        if (controller.signal.aborted) return;
        const rows = body.data as CalendarTask[];
        const dated = rows.filter((task) => task.due_date !== null);
        const datedIds = new Set(dated.map((task) => task.id));
        setTasks(dated);
        if (includeUndated) {
          undatedLoaded.current = true;
          setUndated(rows.filter((task) => task.due_date === null));
        } else {
          setUndated((current) => current.filter((task) => !datedIds.has(task.id)));
        }
        setError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, revision]);

  function place(task: CalendarTask) {
    setTasks((current) => [
      ...current.filter((candidate) => candidate.id !== task.id),
      ...(task.due_date ? [task] : []),
    ]);
    setUndated((current) => [
      ...current.filter((candidate) => candidate.id !== task.id),
      ...(task.due_date ? [] : [task]),
    ]);
  }

  async function reschedule(taskId: string, dueDate: string) {
    const task = [...tasks, ...undated].find((candidate) => candidate.id === taskId);
    if (!task || !task.can_edit || task.due_date === dueDate || pending.current.has(taskId)) return;
    pending.current.add(taskId);
    setMessage(null);
    place({ ...task, due_date: dueDate });
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDate,
          assigneeId: task.assignee_id,
          expectedUpdatedAt: task.updated_at,
        }),
      });
      const payload = (await response.json()) as SavePayload;
      const latest = payload.error?.details?.current;
      if (response.status === 409 && latest) {
        place({ ...task, due_date: latest.due_date, updated_at: latest.updated_at });
        setMessage("This task changed elsewhere. Its latest date is shown; try again.");
        return;
      }
      if (!response.ok || !payload.data) throw new Error("Reschedule rejected");
      place({ ...task, due_date: payload.data.due_date, updated_at: payload.data.updated_at });
    } catch {
      place(task);
      setMessage("The due date could not be changed. The task was returned to where it was.");
    } finally {
      pending.current.delete(taskId);
    }
  }

  return { tasks, undated, loading, error, message, refresh, reschedule };
}

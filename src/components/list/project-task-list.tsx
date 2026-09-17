"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { BoardColumn, BoardTask } from "@/components/board/project-board";
import type { PeerOption } from "@/components/board/mention-autocomplete";
import type { LabelOption } from "@/components/labels/label-picker";
import { FilterBar } from "@/components/board/filter-bar";
import { useFilterState } from "@/components/board/use-filter-state";
import { applyFilters } from "@/lib/filters/apply";
import { useProjectChannel } from "@/lib/realtime/use-project-channel";
import { mergeColumnEvent, mergeTaskEvent } from "@/lib/realtime/board-sync";
import { TaskTable, type InlineTaskPatch } from "./task-table";

export function ProjectTaskList({
  projectId,
  currentUserId,
  initialTasks,
  initialColumns,
  peers,
  labels,
  projectTimezone,
  readOnly,
}: {
  projectId: string;
  currentUserId: string;
  initialTasks: BoardTask[];
  initialColumns: BoardColumn[];
  peers: PeerOption[];
  labels: LabelOption[];
  projectTimezone: string;
  readOnly: boolean;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [columns, setColumns] = useState(initialColumns);
  const [filters, setFilter, clearFilters] = useFilterState();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pendingIds = useRef(new Set<string>());
  const syncStatus = useProjectChannel(projectId, currentUserId, {
    onTask: (event) => setTasks((current) => mergeTaskEvent(current, event, new Set()).tasks),
    onColumn: (event) => setColumns((current) => mergeColumnEvent(current, event)),
    onMembershipRemoved: () => router.replace("/projects?removed=1"),
  });
  const visibleTasks = applyFilters(
    tasks.map((task) => ({
      ...task,
      assignee_id: task.assignee_id ?? null,
      label_ids: task.labels?.map((label) => label.id) ?? [],
      isDone: columns.find((column) => column.id === task.column_id)?.is_done_column ?? false,
    })),
    filters,
    { projectTimezone, now: new Date() },
  );

  async function update(taskId: string, patch: InlineTaskPatch) {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task || readOnly || pendingIds.current.has(taskId)) return;
    pendingIds.current.add(taskId);
    const optimistic = {
      ...task,
      priority: patch.priority ?? task.priority,
      assignee_id: patch.assigneeId === undefined ? task.assignee_id : patch.assigneeId,
      due_date: patch.dueDate === undefined ? task.due_date : patch.dueDate,
    };
    setTasks((current) =>
      current.map((candidate) => (candidate.id === taskId ? optimistic : candidate)),
    );
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title,
          description: task.description,
          priority: optimistic.priority,
          dueDate: optimistic.due_date,
          assigneeId: optimistic.assignee_id ?? null,
          expectedUpdatedAt: task.updated_at,
        }),
      });
      const payload = (await response.json()) as {
        data?: BoardTask;
        error?: { details?: { current?: BoardTask } };
      };
      if (response.status === 409 && payload.error?.details?.current) {
        const latest = payload.error.details.current;
        setTasks((current) =>
          current.map((candidate) =>
            candidate.id === taskId ? { ...candidate, ...latest } : candidate,
          ),
        );
        throw new Error(
          "This task changed elsewhere. The latest version is shown; review it and try again.",
        );
      }
      if (!response.ok || !payload.data) throw new Error("Changes could not be saved. Try again.");
      const saved = payload.data;
      setTasks((current) =>
        current.map((candidate) =>
          candidate.id === taskId ? { ...candidate, ...saved } : candidate,
        ),
      );
    } catch (error) {
      // Only undo our own optimistic object, never a newer realtime update.
      setTasks((current) =>
        current.map((candidate) => (candidate === optimistic ? task : candidate)),
      );
      throw error;
    } finally {
      pendingIds.current.delete(taskId);
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <Link
        href={`/p/${projectId}/board?${searchParams.toString()}`}
        className="text-sm underline underline-offset-4"
      >
        Board view with these filters
      </Link>
      {syncStatus === "reconnecting" && (
        <p role="status" className="text-muted-foreground text-sm">
          Reconnecting to live updates. Editing is temporarily unavailable.
        </p>
      )}
      <FilterBar
        filters={filters}
        onChange={setFilter}
        onClear={clearFilters}
        peers={peers}
        labels={labels}
      />
      <TaskTable
        tasks={visibleTasks}
        columns={columns}
        peers={peers}
        readOnly={readOnly || syncStatus === "reconnecting"}
        onInlineUpdate={update}
        onOpenTask={(task) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("task", task.id);
          router.push(`/p/${projectId}/board?${params}`);
        }}
      />
    </div>
  );
}

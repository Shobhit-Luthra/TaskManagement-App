"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardColumn, BoardTask } from "@/components/board/project-board";
import type { PeerOption } from "@/components/board/mention-autocomplete";
import type { LabelOption } from "@/components/labels/label-picker";
import { FilterBar } from "@/components/board/filter-bar";
import { useFilterState } from "@/components/board/use-filter-state";
import { applyFilters } from "@/lib/filters/apply";
import { useProjectChannel } from "@/lib/realtime/use-project-channel";
import { mergeColumnEvent, mergeTaskEvent } from "@/lib/realtime/board-sync";
import { type InlineTaskPatch } from "./task-table";
import { GroupedTaskList } from "./grouped-task-list";
import { TaskDetailDrawer } from "@/components/board/task-detail-drawer";
import { TaskComposer } from "@/components/board/project-board";
import { Button } from "@/components/ui/button";

export function ProjectTaskList({
  projectId,
  currentUserId,
  initialTasks,
  initialColumns,
  peers,
  labels,
  projectTimezone,
  readOnly,
  currentUserRole = "member",
}: {
  projectId: string;
  currentUserId: string;
  initialTasks: BoardTask[];
  initialColumns: BoardColumn[];
  peers: PeerOption[];
  labels: LabelOption[];
  projectTimezone: string;
  readOnly: boolean;
  currentUserRole?: "owner" | "admin" | "member" | "viewer";
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [columns, setColumns] = useState(initialColumns);
  const [filters, setFilter, clearFilters] = useFilterState();
  const router = useRouter();
  const [editingTask, setEditingTask] = useState<BoardTask | null>(null);
  const [commentRevision, setCommentRevision] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const pendingIds = useRef(new Set<string>());
  const syncStatus = useProjectChannel(projectId, currentUserId, {
    onTask: (event) => setTasks((current) => mergeTaskEvent(current, event, new Set()).tasks),
    onColumn: (event) => setColumns((current) => mergeColumnEvent(current, event)),
    onComment: () => setCommentRevision((value) => value + 1),
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
      {!readOnly && (
        <div className="flex justify-end">
          <Button onClick={() => setComposerOpen((value) => !value)} aria-expanded={composerOpen}>
            {composerOpen ? "Close composer" : "Add task"}
          </Button>
        </div>
      )}
      {composerOpen && !readOnly && syncStatus !== "reconnecting" && columns[0] && (
        <div className="bg-card rounded-lg border">
          <p className="px-3 pt-3 text-sm">New task in {columns[0].name}</p>
          <TaskComposer
            projectId={projectId}
            columnId={columns[0].id}
            onCreated={(task) => {
              setTasks((current) => [...current, task]);
              setComposerOpen(false);
            }}
          />
        </div>
      )}
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
      <GroupedTaskList
        tasks={visibleTasks}
        columns={columns}
        peers={peers}
        readOnly={readOnly || syncStatus === "reconnecting"}
        onInlineUpdate={update}
        onOpenTask={setEditingTask}
      />
      {editingTask && (
        <TaskDetailDrawer
          key={editingTask.id}
          task={editingTask}
          projectId={projectId}
          currentUserId={currentUserId}
          currentUserRole={readOnly ? "viewer" : currentUserRole}
          peers={peers}
          projectLabels={labels}
          commentRevision={commentRevision}
          readOnly={readOnly || syncStatus === "reconnecting"}
          onClose={() => setEditingTask(null)}
          onSaved={(saved) => {
            setTasks((current) =>
              current.map((task) => (task.id === saved.id ? { ...task, ...saved } : task)),
            );
            setEditingTask(null);
          }}
          onDeleted={(id) => {
            setTasks((current) => current.filter((task) => task.id !== id));
            setEditingTask(null);
          }}
          onLabelsSaved={(savedLabels) => {
            setTasks((current) =>
              current.map((task) =>
                task.id === editingTask.id ? { ...task, labels: savedLabels } : task,
              ),
            );
            setEditingTask((current) => (current ? { ...current, labels: savedLabels } : current));
          }}
        />
      )}
    </div>
  );
}

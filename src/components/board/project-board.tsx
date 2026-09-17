"use client";

import { useEffect, useRef, useState } from "react";
import { closestCorners, DndContext, DragOverlay, useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Flag,
  LoaderCircle,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  MUTATION_ECHO_TTL_MS,
  SYNC_GRACE_MS,
  mergeColumnEvent,
  mergeTaskEvent,
} from "@/lib/realtime/board-sync";
import { useProjectChannel } from "@/lib/realtime/use-project-channel";
import { cn } from "@/lib/utils";
import { useBoardDnd } from "./use-board-dnd";
import { Announcer, type AnnouncerHandle } from "./announcer";
import { AssigneePicker } from "./assignee-picker";
import { CommentThread } from "./comment-thread";
import type { PeerOption } from "./mention-autocomplete";
import { LabelChip } from "@/components/labels/label-chip";
import { LabelPicker, type LabelOption } from "@/components/labels/label-picker";
import { applyFilters } from "@/lib/filters/apply";
import { useFilterState } from "./use-filter-state";
import { FilterBar } from "./filter-bar";
import { useBoardShortcuts } from "@/lib/keyboard/use-board-shortcuts";
import { ShortcutsHelpDialog } from "./shortcuts-help-dialog";

export type BoardColumn = {
  id: string;
  name: string;
  position: number;
  wip_limit: number | null;
  is_done_column?: boolean;
};

export type BoardTask = {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  position: number;
  created_at: string;
  updated_at: string;
  assignee_id?: string | null;
  labels?: LabelOption[];
};

export function ProjectBoard({
  projectId,
  currentUserId,
  initialColumns,
  initialTasks,
  readOnly: readOnlyRole,
  currentUserRole,
  peers,
  projectLabels,
  projectTimezone,
}: {
  projectId: string;
  currentUserId: string;
  initialColumns: BoardColumn[];
  initialTasks: BoardTask[];
  readOnly: boolean;
  currentUserRole: "owner" | "admin" | "member" | "viewer";
  peers: PeerOption[];
  projectLabels: LabelOption[];
  projectTimezone: string;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [columns, setColumns] = useState(initialColumns);
  const [activeColumn, setActiveColumn] = useState(0);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<BoardTask | null>(null);
  const [commentRevision, setCommentRevision] = useState(0);
  const inFlightMutations = useRef<Set<string>>(new Set());
  const announcerRef = useRef<AnnouncerHandle>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const syncStatus = useProjectChannel(projectId, currentUserId, {
    onTask: (event) => {
      setTasks((current) => {
        const result = mergeTaskEvent(current, event, inFlightMutations.current);
        if (result.consumedMutationId) inFlightMutations.current.delete(result.consumedMutationId);
        return result.tasks;
      });
    },
    onColumn: (event) => setColumns((current) => mergeColumnEvent(current, event)),
    onComment: () => setCommentRevision((current) => current + 1),
    onMembershipRemoved: () => {
      router.replace("/projects?removed=1");
    },
  });

  const [degraded, setDegraded] = useState(false);
  useEffect(() => {
    if (syncStatus !== "reconnecting") return;
    const timer = window.setTimeout(() => setDegraded(true), SYNC_GRACE_MS);
    return () => {
      window.clearTimeout(timer);
      setDegraded(false);
    };
  }, [syncStatus]);

  const readOnly = readOnlyRole || degraded;
  const [filters, setFilter, clearFilters] = useFilterState();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);

  useEffect(() => {
    if (searchFocusRequest > 0) filterBarRef.current?.querySelector("input")?.focus();
  }, [searchFocusRequest]);

  useBoardShortcuts({
    onFocusSearch: () => {
      setFiltersExpanded(true);
      setSearchFocusRequest((current) => current + 1);
    },
    onToggleFilters: () => setFiltersExpanded((current) => !current),
    onNewTask: () => {
      if (!readOnly) composerRef.current?.focus();
    },
    onShowHelp: () => setShortcutsOpen(true),
  });

  useEffect(() => {
    if (!readOnly && tasks.length === 0) composerRef.current?.focus();
  }, [readOnly, tasks.length]);

  useEffect(() => {
    const taskId = searchParams.get("task");
    if (!taskId) return;
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    const timer = window.setTimeout(() => setEditingTask(task), 0);
    return () => window.clearTimeout(timer);
  }, [searchParams, tasks]);

  function appendTask(task: BoardTask) {
    setTasks((current) => [...current, task]);
  }

  async function moveTask(
    task: BoardTask,
    columnId: string,
    proposedPosition?: number,
    proposedMutationId?: string,
  ) {
    if (movingTaskId) return;
    const targetTasks = tasks.filter((candidate) => candidate.column_id === columnId);
    const position =
      proposedPosition ??
      (targetTasks.length === 0
        ? 1000
        : Math.min(...targetTasks.map((candidate) => candidate.position)) - 1);
    const previousTask = task;
    const mutationId = proposedMutationId ?? crypto.randomUUID();
    inFlightMutations.current.add(mutationId);
    window.setTimeout(() => inFlightMutations.current.delete(mutationId), MUTATION_ECHO_TTL_MS);
    setMoveError(null);
    setMovingTaskId(task.id);
    setTasks((current) =>
      current.map((candidate) =>
        candidate.id === task.id ? { ...candidate, column_id: columnId, position } : candidate,
      ),
    );
    const targetColumn = columns.find((column) => column.id === columnId);
    if (targetColumn) announcerRef.current?.announce(`${task.title} moved to ${targetColumn.name}`);
    try {
      const response = await fetch(`/api/v1/tasks/${task.id}/position`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId, position, mutationId }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isMovedTask(payload)) throw new Error("Move rejected");
      setTasks((current) =>
        current.map((candidate) =>
          candidate.id === task.id ? { ...candidate, ...payload.data } : candidate,
        ),
      );
    } catch {
      setTasks((current) =>
        current.map((candidate) => (candidate.id === task.id ? previousTask : candidate)),
      );
      setMoveError("Task could not be moved. It was returned to its previous column.");
      announcerRef.current?.announce(
        `${task.title} could not be moved and was returned to its previous column`,
      );
    } finally {
      setMovingTaskId(null);
    }
  }

  const dnd = useBoardDnd({
    tasks,
    columns,
    readOnly,
    onMove: (taskId, columnId, position, mutationId) => {
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (task) void moveTask(task, columnId, position, mutationId);
    },
  });

  function updateTask(task: BoardTask) {
    setTasks((current) =>
      current.map((candidate) =>
        candidate.id === task.id ? { ...candidate, ...task } : candidate,
      ),
    );
    setEditingTask(null);
  }

  function deleteTask(taskId: string) {
    setTasks((current) => current.filter((task) => task.id !== taskId));
    setEditingTask(null);
  }

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
  const hasFilters = Boolean(
    filters.q ||
    filters.assignee.length ||
    filters.label.length ||
    filters.priority.length ||
    filters.due,
  );

  if (columns.length === 0) {
    return (
      <section className="bg-card m-6 rounded-xl border border-dashed p-8 text-center">
        <h2 className="text-lg font-semibold">This board has no columns</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Refresh the page after adding a workflow.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Board columns" className="bg-muted/40 relative flex-1 overflow-hidden">
      <Announcer ref={announcerRef} />
      {syncStatus === "reconnecting" && (
        <p
          role="status"
          className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          {degraded
            ? "Reconnecting to live updates. The board is read-only until the connection returns."
            : "Reconnecting to live updates…"}
        </p>
      )}
      <div className="bg-background flex items-center justify-between border-b px-4 py-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={filtersExpanded}
          aria-controls="board-filters"
          onClick={() => setFiltersExpanded((current) => !current)}
        >
          {filtersExpanded ? "Hide filters" : "Show filters"}
        </Button>
        <ShortcutsHelpDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      </div>
      <div id="board-filters" ref={filterBarRef} hidden={!filtersExpanded}>
        <FilterBar
          filters={filters}
          onChange={setFilter}
          onClear={clearFilters}
          peers={peers}
          labels={projectLabels}
        />
      </div>
      <div className="flex items-center justify-between px-4 pt-3 md:hidden">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous column"
          disabled={activeColumn === 0}
          onClick={() => setActiveColumn((current) => Math.max(0, current - 1))}
        >
          <ChevronLeft />
        </Button>
        <p className="text-sm font-medium">
          {activeColumn + 1} of {columns.length}
        </p>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next column"
          disabled={activeColumn === columns.length - 1}
          onClick={() => setActiveColumn((current) => Math.min(columns.length - 1, current + 1))}
        >
          <ChevronRight />
        </Button>
      </div>
      <DndContext
        sensors={dnd.sensors}
        collisionDetection={closestCorners}
        onDragStart={dnd.onDragStart}
        onDragOver={dnd.onDragOver}
        onDragEnd={dnd.onDragEnd}
        onDragCancel={dnd.onDragCancel}
      >
        <div className="flex h-full gap-3 overflow-x-auto p-4 pt-3 md:pt-4">
          {columns.map((column, index) => {
            const columnTasks = visibleTasks
              .filter((task) => task.column_id === column.id)
              .sort((a, b) => a.position - b.position);
            const atWipLimit = column.wip_limit !== null && columnTasks.length >= column.wip_limit;
            return (
              <ColumnDropSurface
                key={column.id}
                columnId={column.id}
                className={cn(
                  "bg-card flex min-h-[calc(100dvh-180px)] w-[min(21rem,calc(100vw-2rem))] shrink-0 flex-col rounded-xl shadow-sm ring-1 ring-black/5 md:w-72",
                  index !== activeColumn && "max-md:hidden",
                )}
              >
                <header className="bg-card sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b px-4 py-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{column.name}</h2>
                    <p
                      className={cn(
                        "mt-0.5 flex items-center gap-1 text-xs",
                        atWipLimit
                          ? "font-medium text-amber-700 dark:text-amber-400"
                          : "text-muted-foreground",
                      )}
                    >
                      {columnTasks.length} {columnTasks.length === 1 ? "task" : "tasks"}
                      {column.wip_limit ? ` · WIP ${column.wip_limit}` : ""}
                      {column.wip_limit && ` ${columnTasks.length}/${column.wip_limit}`}
                      {atWipLimit && <TriangleAlert className="size-3" aria-label="At WIP limit" />}
                    </p>
                  </div>
                  {!readOnly && (
                    <Plus className="text-muted-foreground size-4" aria-hidden="true" />
                  )}
                </header>
                <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
                  <SortableContext
                    items={columnTasks.map((task) => task.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {columnTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        columns={columns}
                        readOnly={readOnly}
                        moving={movingTaskId === task.id}
                        onMove={moveTask}
                        onOpen={() => setEditingTask(task)}
                      />
                    ))}
                  </SortableContext>
                  {columnTasks.length === 0 && (
                    <div className="text-muted-foreground flex min-h-28 items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm">
                      {hasFilters
                        ? "No matching tasks"
                        : readOnly
                          ? "No tasks in this column"
                          : "Add a task to get started"}
                    </div>
                  )}
                </div>
                {!readOnly && (
                  <TaskComposer
                    projectId={projectId}
                    columnId={column.id}
                    onCreated={appendTask}
                    inputRef={index === activeColumn ? composerRef : undefined}
                  />
                )}
              </ColumnDropSurface>
            );
          })}
        </div>
        <DragOverlay>
          {dnd.activeTask && (
            <TaskCard
              task={dnd.activeTask}
              columns={columns}
              readOnly
              moving={false}
              onMove={moveTask}
              onOpen={() => {}}
            />
          )}
        </DragOverlay>
      </DndContext>
      {moveError && (
        <p className="sr-only" role="alert">
          {moveError}
        </p>
      )}
      {editingTask && (
        <TaskEditor
          projectId={projectId}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          peers={peers}
          projectLabels={projectLabels}
          commentRevision={commentRevision}
          onLabelsSaved={(labels) => {
            setTasks((current) =>
              current.map((candidate) =>
                candidate.id === editingTask.id ? { ...candidate, labels } : candidate,
              ),
            );
            setEditingTask((current) => (current ? { ...current, labels } : current));
          }}
          task={editingTask}
          readOnly={readOnly}
          onClose={() => setEditingTask(null)}
          onSaved={updateTask}
          onDeleted={deleteTask}
        />
      )}
    </section>
  );
}

export function TaskComposer({
  projectId,
  columnId,
  onCreated,
  inputRef,
}: {
  projectId: string;
  columnId: string;
  onCreated: (task: BoardTask) => void;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [title, setTitle] = useState("");
  const [unsavedTitle, setUnsavedTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(titleToSave = title) {
    const trimmedTitle = titleToSave.trim();
    if (!trimmedTitle) {
      setError("Add a task title first.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmedTitle, columnId }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isBoardTask(payload)) {
        setError("Task could not be saved. Your title is still here—try again.");
        return;
      }
      onCreated(payload.data);
      setTitle("");
      setUnsavedTitle(null);
    } catch {
      setTitle("");
      setUnsavedTitle(trimmedTitle);
      setError("Your task is saved locally until you can retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="border-t p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="sr-only" htmlFor={`task-title-${columnId}`}>
        New task in this column
      </label>
      <textarea
        ref={inputRef}
        id={`task-title-${columnId}`}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
          if (event.key === "Escape") {
            setTitle("");
            setError(null);
          }
        }}
        maxLength={200}
        disabled={pending}
        placeholder="Add a task…"
        rows={2}
        className="bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/40 w-full resize-none rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">Enter to add · Shift + Enter for a new line</p>
        <Button size="sm" type="submit" disabled={pending || title.trim().length === 0}>
          <Plus /> {pending ? "Adding" : "Add"}
        </Button>
      </div>
      {unsavedTitle && (
        <div className="bg-muted mt-3 flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm">
          <span className="min-w-0 truncate">
            <strong>Unsaved</strong> · {unsavedTitle}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void submit(unsavedTitle)}
          >
            Retry
          </Button>
        </div>
      )}
      {error && (
        <p className="text-destructive mt-2 text-sm" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function TaskCard({
  task,
  columns,
  readOnly,
  moving,
  onMove,
  onOpen,
}: {
  task: BoardTask;
  columns: BoardColumn[];
  readOnly: boolean;
  moving: boolean;
  onMove: (task: BoardTask, columnId: string) => Promise<void>;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task", columnId: task.column_id },
    disabled: readOnly,
  });
  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const due = task.due_date ? new Date(`${task.due_date}T00:00:00`) : null;
  const isOverdue = due ? due < startOfToday() : false;
  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: reduceMotion ? undefined : transition,
      }}
      {...(readOnly ? {} : attributes)}
      {...(readOnly ? {} : listeners)}
      aria-roledescription={readOnly ? undefined : "sortable task card"}
      className={cn(
        "bg-background rounded-lg border p-3 shadow-sm transition-shadow hover:shadow-md",
        !readOnly && "cursor-grab active:cursor-grabbing",
        (moving || isDragging) && "opacity-50",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="focus-visible:ring-ring line-clamp-2 w-full text-left text-sm leading-5 font-medium break-words hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:outline-none"
      >
        {task.title}
      </button>
      {task.labels && task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {task.labels.map((label) => (
            <LabelChip key={label.id} name={label.name} color={label.color} />
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <span
          className={cn("inline-flex items-center gap-1 capitalize", priorityColor(task.priority))}
        >
          <Flag className="size-3" aria-hidden="true" />
          {task.priority}
        </span>
        {due && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              isOverdue && "text-destructive font-medium",
            )}
          >
            {isOverdue && <CircleAlert className="size-3" aria-label="Overdue" />}
            {!isOverdue && <CalendarDays className="size-3" aria-hidden="true" />}
            {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(due)}
          </span>
        )}
      </div>
      {!readOnly && (
        <label className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
          <span className="sr-only">Move {task.title}</span>
          <span>Move to</span>
          <select
            value={task.column_id}
            disabled={moving}
            onChange={(event) => void onMove(task, event.target.value)}
            className="bg-background text-foreground focus-visible:ring-ring/40 min-w-0 flex-1 rounded border px-2 py-1 outline-none focus-visible:ring-2"
          >
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </article>
  );
}

function ColumnDropSurface({
  columnId,
  className,
  children,
}: {
  columnId: string;
  className: string;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `column:${columnId}`,
    data: { type: "column", columnId },
  });
  return (
    <section ref={setNodeRef} className={cn(className, isOver && "ring-primary ring-2")}>
      {children}
    </section>
  );
}

function isBoardTask(value: unknown): value is { data: BoardTask } {
  if (typeof value !== "object" || value === null || !("data" in value)) return false;
  const task = value.data;
  return (
    typeof task === "object" &&
    task !== null &&
    "id" in task &&
    typeof task.id === "string" &&
    "column_id" in task
  );
}

function isConflictPayload(
  value: unknown,
): value is { error: { details: { current: BoardTask } } } {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = value.error;
  if (typeof error !== "object" || error === null || !("details" in error)) return false;
  const details = error.details;
  return (
    typeof details === "object" &&
    details !== null &&
    "current" in details &&
    typeof details.current === "object" &&
    details.current !== null
  );
}

function TaskEditor({
  projectId,
  currentUserId,
  currentUserRole,
  peers,
  projectLabels,
  commentRevision,
  onLabelsSaved,
  task,
  readOnly,
  onClose,
  onSaved,
  onDeleted,
}: {
  projectId: string;
  currentUserId: string;
  currentUserRole: "owner" | "admin" | "member" | "viewer";
  peers: PeerOption[];
  projectLabels: LabelOption[];
  commentRevision: number;
  onLabelsSaved: (labels: LabelOption[]) => void;
  task: BoardTask;
  readOnly: boolean;
  onClose: () => void;
  onSaved: (task: BoardTask) => void;
  onDeleted: (taskId: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [priority, setPriority] = useState<BoardTask["priority"]>(task.priority);
  const [assigneeId, setAssigneeId] = useState<string | null>(task.assignee_id ?? null);
  const [labelIds, setLabelIds] = useState<string[]>(task.labels?.map((label) => label.id) ?? []);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(task.updated_at);
  const [conflict, setConflict] = useState<BoardTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function save(expectedAt = expectedUpdatedAt) {
    if (!title.trim()) {
      setError("A task needs a title.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/v1/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          dueDate: dueDate || null,
          priority,
          assigneeId,
          expectedUpdatedAt: expectedAt,
        }),
      });
      const payload: unknown = await response.json();
      if (response.status === 409 && isConflictPayload(payload)) {
        setConflict(payload.error.details.current);
        return;
      }
      if (!response.ok || !isBoardTask(payload)) {
        setError("Your changes could not be saved. Please try again.");
        return;
      }
      onSaved(payload.data);
    } catch {
      setError("You appear to be offline. Your changes are still here—try again when connected.");
    } finally {
      setPending(false);
    }
  }

  async function deleteTask() {
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/v1/tasks/${task.id}`, { method: "DELETE" });
      if (!response.ok) {
        setError("Task could not be deleted. Please try again.");
        return;
      }
      onDeleted(task.id);
    } catch {
      setError("You appear to be offline. Reconnect and try again.");
    } finally {
      setPending(false);
    }
  }

  async function saveLabels(ids: string[]) {
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/v1/tasks/${task.id}/labels`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labelIds: ids }),
      });
      if (!response.ok) {
        setError("Labels could not be saved. Please try again.");
        return;
      }
      setLabelIds(ids);
      onLabelsSaved(projectLabels.filter((label) => ids.includes(label.id)));
    } catch {
      setError(
        "You appear to be offline. Your label changes are still here—try again when connected.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:justify-center sm:p-6"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-editor-title"
        className="bg-card max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-t-xl p-5 shadow-xl sm:rounded-xl sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id="task-editor-title" className="text-lg font-semibold">
            Edit task
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <form
          className="mt-5 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="block space-y-2 text-sm font-medium">
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              readOnly={readOnly}
              maxLength={200}
              autoFocus={!readOnly}
              className="bg-background focus-visible:ring-ring/40 w-full rounded-md border px-3 py-2 text-base font-normal outline-none focus-visible:ring-2"
            />
          </label>
          <label className="block space-y-2 text-sm font-medium">
            Description <span className="text-muted-foreground font-normal">(optional)</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              readOnly={readOnly}
              maxLength={20_000}
              rows={6}
              className="bg-background focus-visible:ring-ring/40 w-full resize-y rounded-md border px-3 py-2 text-base font-normal outline-none focus-visible:ring-2"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-2 text-sm font-medium">
              Priority
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as BoardTask["priority"])}
                disabled={readOnly}
                className="bg-background focus-visible:ring-ring/40 w-full rounded-md border px-3 py-2 text-base font-normal outline-none focus-visible:ring-2"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <AssigneePicker
              projectId={projectId}
              value={assigneeId}
              onChange={setAssigneeId}
              disabled={readOnly || pending}
            />
            <label className="block space-y-2 text-sm font-medium">
              Due date <span className="text-muted-foreground font-normal">(optional)</span>
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                readOnly={readOnly}
                className="bg-background focus-visible:ring-ring/40 w-full rounded-md border px-3 py-2 text-base font-normal outline-none focus-visible:ring-2"
              />
            </label>
          </div>
          <LabelPicker
            labels={projectLabels}
            selectedIds={labelIds}
            onChange={(ids) => void saveLabels(ids)}
            readOnly={readOnly || pending}
          />
          <SubtaskList taskId={task.id} readOnly={readOnly} />
          <CommentThread
            key={task.id}
            taskId={task.id}
            projectId={projectId}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            readOnly={readOnly}
            peers={peers}
            refreshVersion={commentRevision}
          />
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          {conflict && (
            <div
              role="alert"
              className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
            >
              <p className="font-medium">This task changed since you opened it.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setTitle(conflict.title);
                    setDescription(conflict.description ?? "");
                    setDueDate(conflict.due_date ?? "");
                    setPriority(conflict.priority);
                    setAssigneeId(conflict.assignee_id ?? null);
                    setExpectedUpdatedAt(conflict.updated_at);
                    setConflict(null);
                  }}
                >
                  Reload their version
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setExpectedUpdatedAt(conflict.updated_at);
                    setConflict(null);
                    void save(conflict.updated_at);
                  }}
                >
                  Overwrite with mine
                </Button>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-3 border-t pt-4">
            {!readOnly &&
              (confirmingDelete ? (
                <div className="mr-auto flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-destructive font-medium">Delete this task?</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => void deleteTask()}
                    disabled={pending}
                  >
                    Delete task
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive hover:text-destructive mr-auto"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={pending}
                >
                  Delete
                </Button>
              ))}
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={pending}>
                {pending ? "Saving" : "Save changes"}
              </Button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

type Subtask = {
  id: string;
  task_id: string;
  title: string;
  is_completed: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};

function SubtaskList({ taskId, readOnly }: { taskId: string; readOnly: boolean }) {
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/tasks/${taskId}/subtasks`)
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok || !isSubtaskList(payload)) throw new Error("Load rejected");
        if (active) setSubtasks(payload.data);
      })
      .catch(() => active && setError("Subtasks could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [taskId]);

  async function addSubtask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    setError(null);
    setPendingId("new");
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/subtasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isSubtask(payload)) throw new Error("Create rejected");
      setSubtasks((current) => [...current, payload.data]);
      setTitle("");
    } catch {
      setError("Subtask could not be added. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  async function updateSubtask(
    subtask: Subtask,
    change: { title?: string; isCompleted?: boolean },
  ) {
    setError(null);
    setPendingId(subtask.id);
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/subtasks/${subtask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isSubtask(payload)) throw new Error("Update rejected");
      setSubtasks((current) =>
        current.map((item) => (item.id === subtask.id ? payload.data : item)),
      );
    } catch {
      setError("Subtask could not be updated. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  async function removeSubtask(subtask: Subtask) {
    setError(null);
    setPendingId(subtask.id);
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/subtasks/${subtask.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Delete rejected");
      setSubtasks((current) => current.filter((item) => item.id !== subtask.id));
    } catch {
      setError("Subtask could not be removed. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  const completed = subtasks.filter((subtask) => subtask.is_completed).length;
  return (
    <section className="space-y-3 border-t pt-5" aria-labelledby="subtasks-title">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="subtasks-title" className="font-medium">
          Subtasks
        </h3>
        {!loading && (
          <p className="text-muted-foreground text-sm">
            {completed}/{subtasks.length} complete
          </p>
        )}
      </div>
      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" /> Loading subtasks
        </div>
      ) : (
        <ul className="space-y-1.5" aria-live="polite">
          {subtasks.map((subtask) => (
            <li
              key={subtask.id}
              className="hover:bg-muted/60 flex items-center gap-2 rounded-md px-1 py-1.5"
            >
              <button
                type="button"
                disabled={readOnly || pendingId === subtask.id}
                onClick={() => void updateSubtask(subtask, { isCompleted: !subtask.is_completed })}
                aria-label={`${subtask.is_completed ? "Mark incomplete" : "Mark complete"}: ${subtask.title}`}
                className={cn(
                  "focus-visible:ring-ring grid size-5 shrink-0 place-items-center rounded border transition-colors focus-visible:ring-2 focus-visible:outline-none",
                  subtask.is_completed && "border-primary bg-primary text-primary-foreground",
                  readOnly && "cursor-default",
                )}
              >
                {subtask.is_completed && <Check className="size-3.5" />}
              </button>
              <input
                defaultValue={subtask.title}
                readOnly={readOnly}
                disabled={pendingId === subtask.id}
                onBlur={(event) => {
                  const nextTitle = event.target.value.trim();
                  if (nextTitle && nextTitle !== subtask.title)
                    void updateSubtask(subtask, { title: nextTitle });
                  else event.target.value = subtask.title;
                }}
                className={cn(
                  "focus-visible:ring-ring min-w-0 flex-1 bg-transparent text-sm outline-none focus-visible:ring-2",
                  subtask.is_completed && "text-muted-foreground line-through",
                  !readOnly && "hover:bg-background rounded px-1 py-0.5",
                )}
              />
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${subtask.title}`}
                  disabled={pendingId === subtask.id}
                  onClick={() => void removeSubtask(subtask)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!loading && subtasks.length === 0 && (
        <p className="text-muted-foreground text-sm">Break this task into smaller steps.</p>
      )}
      {!readOnly && (
        <form className="flex gap-2" onSubmit={(event) => void addSubtask(event)}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            placeholder="Add a subtask"
            className="bg-background placeholder:text-muted-foreground focus-visible:ring-ring/40 h-9 min-w-0 flex-1 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
          />
          <Button type="submit" size="sm" disabled={!title.trim() || pendingId === "new"}>
            {pendingId === "new" ? "Adding" : "Add"}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </section>
  );
}

function isSubtask(value: unknown): value is { data: Subtask } {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    typeof value.data === "object" &&
    value.data !== null &&
    "id" in value.data &&
    typeof value.data.id === "string"
  );
}

function isSubtaskList(value: unknown): value is { data: Subtask[] } {
  return (
    typeof value === "object" && value !== null && "data" in value && Array.isArray(value.data)
  );
}

function isMovedTask(
  value: unknown,
): value is { data: Pick<BoardTask, "id" | "column_id" | "position" | "updated_at"> } {
  if (typeof value !== "object" || value === null || !("data" in value)) return false;
  const task = value.data;
  return (
    typeof task === "object" &&
    task !== null &&
    "id" in task &&
    typeof task.id === "string" &&
    "column_id" in task &&
    typeof task.column_id === "string" &&
    "position" in task &&
    typeof task.position === "number"
  );
}

function priorityColor(priority: BoardTask["priority"]) {
  return {
    low: "text-slate-500",
    medium: "text-blue-600",
    high: "text-amber-700",
    urgent: "text-destructive",
  }[priority];
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

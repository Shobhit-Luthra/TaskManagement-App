"use client";

import { useEffect, useRef, useState } from "react";
import { closestCorners, DndContext, DragOverlay, useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Flag,
  Plus,
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
import { TaskDetailDrawer, isBoardTask } from "./task-detail-drawer";
import type { PeerOption } from "./mention-autocomplete";
import { LabelChip } from "@/components/labels/label-chip";
import { type LabelOption } from "@/components/labels/label-picker";
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

  function closeTask() {
    setEditingTask(null);
    if (searchParams.has("task")) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("task");
      router.replace(`/p/${projectId}/board${params.size ? `?${params}` : ""}`, { scroll: false });
    }
  }

  function updateTask(task: BoardTask) {
    setTasks((current) =>
      current.map((candidate) =>
        candidate.id === task.id ? { ...candidate, ...task } : candidate,
      ),
    );
    closeTask();
  }

  function deleteTask(taskId: string) {
    setTasks((current) => current.filter((task) => task.id !== taskId));
    closeTask();
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
    <section aria-label="Board columns" className="bg-surface-low relative flex-1 overflow-hidden">
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
        id={`board-${projectId}`}
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
                  "bg-card flex min-h-[28rem] w-[min(21rem,calc(100vw-2rem))] shrink-0 flex-col rounded-xl border md:w-80",
                  index !== activeColumn && "max-md:hidden",
                )}
              >
                <header className="bg-card sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b px-4 py-3">
                  <div className="min-w-0">
                    <h2 className="text-headline-md truncate font-serif font-medium">
                      {column.name}
                    </h2>
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
                        peers={peers}
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
              peers={peers}
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
        <TaskDetailDrawer
          key={editingTask.id}
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
          onClose={closeTask}
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
  const [priority, setPriority] = useState<BoardTask["priority"]>("medium");
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
        body: JSON.stringify({ title: trimmedTitle, columnId, priority }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isBoardTask(payload)) {
        setError("Task could not be saved. Your title is still here—try again.");
        return;
      }
      onCreated(payload.data);
      setTitle("");
      setPriority("medium");
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
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`task-priority-${columnId}`}>
            Priority
          </label>
          <select
            id={`task-priority-${columnId}`}
            value={priority}
            onChange={(event) => setPriority(event.target.value as BoardTask["priority"])}
            disabled={pending}
            className="bg-background focus-visible:border-ring focus-visible:ring-ring/40 rounded-md border px-2 py-1.5 text-xs outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
          <Button size="sm" type="submit" disabled={pending || title.trim().length === 0}>
            <Plus /> {pending ? "Adding" : "Add"}
          </Button>
        </div>
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
  peers,
  task,
  columns,
  readOnly,
  moving,
  onMove,
  onOpen,
}: {
  peers: PeerOption[];
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
  const assignee = peers.find((peer) => peer.userId === task.assignee_id);
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
        "bg-surface-lowest hover:border-outline rounded-lg border p-4 transition-colors",
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
      {assignee && (
        <p className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
          <span
            aria-hidden="true"
            className="bg-secondary text-secondary-foreground flex size-6 items-center justify-center rounded-full font-medium"
          >
            {assignee.displayName.slice(0, 2).toUpperCase()}
          </span>
          <span className="truncate">{assignee.displayName}</span>
        </p>
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
    low: "text-muted-foreground",
    medium: "text-brand-primary",
    high: "text-status-amber-fg",
    urgent: "text-destructive",
  }[priority];
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

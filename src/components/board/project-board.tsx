"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Flag,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  MUTATION_ECHO_TTL_MS,
  SYNC_GRACE_MS,
  mergeColumnEvent,
  mergeTaskEvent,
} from "@/lib/realtime/board-sync";
import { useProjectChannel } from "@/lib/realtime/use-project-channel";
import { cn } from "@/lib/utils";

export type BoardColumn = {
  id: string;
  name: string;
  position: number;
  wip_limit: number | null;
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
};

export function ProjectBoard({
  projectId,
  initialColumns,
  initialTasks,
  readOnly: readOnlyRole,
}: {
  projectId: string;
  initialColumns: BoardColumn[];
  initialTasks: BoardTask[];
  readOnly: boolean;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [columns, setColumns] = useState(initialColumns);
  const [activeColumn, setActiveColumn] = useState(0);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<BoardTask | null>(null);
  const inFlightMutations = useRef<Set<string>>(new Set());

  const syncStatus = useProjectChannel(projectId, {
    onTask: (event) => {
      setTasks((current) => {
        const result = mergeTaskEvent(current, event, inFlightMutations.current);
        if (result.consumedMutationId) inFlightMutations.current.delete(result.consumedMutationId);
        return result.tasks;
      });
    },
    onColumn: (event) => setColumns((current) => mergeColumnEvent(current, event)),
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const initialPriority = searchParams.get("priority");
  const [priority, setPriority] = useState<BoardTask["priority"] | "all">(
    isPriority(initialPriority) ? initialPriority : "all",
  );
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!readOnly && tasks.length === 0) composerRef.current?.focus();
  }, [readOnly, tasks.length]);

  function appendTask(task: BoardTask) {
    setTasks((current) => [...current, task]);
  }

  async function moveTask(task: BoardTask, columnId: string) {
    if (columnId === task.column_id || movingTaskId) return;
    const targetTasks = tasks.filter((candidate) => candidate.column_id === columnId);
    const position =
      targetTasks.length === 0
        ? 1
        : Math.min(...targetTasks.map((candidate) => candidate.position)) - 1;
    const previousTask = task;
    const mutationId = crypto.randomUUID();
    inFlightMutations.current.add(mutationId);
    window.setTimeout(() => inFlightMutations.current.delete(mutationId), MUTATION_ECHO_TTL_MS);
    setMoveError(null);
    setMovingTaskId(task.id);
    setTasks((current) =>
      current.map((candidate) =>
        candidate.id === task.id ? { ...candidate, column_id: columnId, position } : candidate,
      ),
    );
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
    } finally {
      setMovingTaskId(null);
    }
  }

  function updateTask(task: BoardTask) {
    setTasks((current) =>
      current.map((candidate) => (candidate.id === task.id ? task : candidate)),
    );
    setEditingTask(null);
  }

  function deleteTask(taskId: string) {
    setTasks((current) => current.filter((task) => task.id !== taskId));
    setEditingTask(null);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      else params.delete("q");
      if (priority === "all") params.delete("priority");
      else params.set("priority", priority);
      const suffix = params.toString();
      router.replace(suffix ? `${pathname}?${suffix}` : pathname, { scroll: false });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [pathname, priority, query, router]);

  function resetFilters() {
    setQuery("");
    setPriority("all");
    router.replace(pathname, { scroll: false });
  }

  const visibleTasks = tasks.filter((task) => {
    const matchesQuery =
      !query.trim() || task.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return matchesQuery && (priority === "all" || task.priority === priority);
  });
  const hasFilters = Boolean(query.trim()) || priority !== "all";

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
      <div className="bg-background flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search tasks</span>
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
            className="bg-background placeholder:text-muted-foreground focus-visible:ring-ring/40 h-9 w-full rounded-md border py-2 pr-3 pl-9 text-base outline-none focus-visible:ring-2 sm:text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <span className="text-muted-foreground">Priority</span>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as BoardTask["priority"] | "all")}
            className="bg-background focus-visible:ring-ring/40 h-9 rounded-md border px-2 text-sm font-normal outline-none focus-visible:ring-2"
          >
            <option value="all">All</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        {hasFilters && (
          <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
            <X /> Clear filters
          </Button>
        )}
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
      <div className="flex h-full gap-3 overflow-x-auto p-4 pt-3 md:pt-4">
        {columns.map((column, index) => {
          const columnTasks = visibleTasks
            .filter((task) => task.column_id === column.id)
            .sort((a, b) => a.position - b.position);
          return (
            <section
              key={column.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const taskId = event.dataTransfer.getData("text/plain");
                const task = tasks.find((candidate) => candidate.id === taskId);
                if (task) void moveTask(task, column.id);
              }}
              className={cn(
                "bg-card flex min-h-[calc(100dvh-180px)] w-[min(21rem,calc(100vw-2rem))] shrink-0 flex-col rounded-xl shadow-sm ring-1 ring-black/5 md:w-72",
                index !== activeColumn && "max-md:hidden",
              )}
            >
              <header className="bg-card sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b px-4 py-3">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{column.name}</h2>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {columnTasks.length} {columnTasks.length === 1 ? "task" : "tasks"}
                    {column.wip_limit ? ` · WIP ${column.wip_limit}` : ""}
                  </p>
                </div>
                {!readOnly && <Plus className="text-muted-foreground size-4" aria-hidden="true" />}
              </header>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
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
                  inputRef={index === 0 ? composerRef : undefined}
                />
              )}
            </section>
          );
        })}
      </div>
      {moveError && (
        <p className="sr-only" role="alert">
          {moveError}
        </p>
      )}
      {editingTask && (
        <TaskEditor
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

function TaskComposer({
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
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    const trimmedTitle = title.trim();
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
    } catch {
      setError("You appear to be offline. Reconnect and try again.");
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
  const due = task.due_date ? new Date(`${task.due_date}T00:00:00`) : null;
  const isOverdue = due ? due < startOfToday() : false;
  return (
    <article
      draggable={!readOnly && !moving}
      onDragStart={(event) => event.dataTransfer.setData("text/plain", task.id)}
      className={cn(
        "bg-background rounded-lg border p-3 shadow-sm transition-shadow hover:shadow-md",
        !readOnly && "cursor-grab active:cursor-grabbing",
        moving && "opacity-50",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="focus-visible:ring-ring line-clamp-2 w-full text-left text-sm leading-5 font-medium break-words hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:outline-none"
      >
        {task.title}
      </button>
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

function TaskEditor({
  task,
  readOnly,
  onClose,
  onSaved,
  onDeleted,
}: {
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
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        }),
      });
      const payload: unknown = await response.json();
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
        <form className="mt-5 space-y-5" onSubmit={(event) => void save(event)}>
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
          <SubtaskList taskId={task.id} readOnly={readOnly} />
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
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

function isPriority(value: string | null): value is BoardTask["priority"] {
  return value === "low" || value === "medium" || value === "high" || value === "urgent";
}

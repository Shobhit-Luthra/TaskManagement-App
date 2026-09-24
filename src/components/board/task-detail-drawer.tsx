"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssigneePicker } from "./assignee-picker";
import { CommentThread } from "./comment-thread";
import { TaskActivity } from "./task-activity";
import type { PeerOption } from "./mention-autocomplete";
import { LabelPicker, type LabelOption } from "@/components/labels/label-picker";
import type { BoardTask } from "./project-board";
import { cn } from "@/lib/utils";

export function isBoardTask(value: unknown): value is { data: BoardTask } {
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

export function TaskDetailDrawer({
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
  onSubtaskCountsChange,
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
  onSubtaskCountsChange?: (done: number, total: number) => void;
}) {
  const [returnFocus] = useState(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );
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
    if (readOnly || pending) return;
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
    if (readOnly || pending) return;
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
    if (readOnly || pending) return;
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
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <SheetContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
        }}
        className="w-full gap-0 overflow-y-auto sm:max-w-[640px]"
        showCloseButton={!pending}
      >
        <SheetHeader className="border-b px-6 py-6 pr-12">
          <SheetTitle className="text-headline-md font-serif font-medium">
            {readOnly ? "Task details" : "Edit task"}
          </SheetTitle>
          <SheetDescription>Review the details and keep your team up to date.</SheetDescription>
        </SheetHeader>
        <form
          id="task-details-form"
          className="space-y-6 p-6"
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
        </form>
        <div className="space-y-6 border-t p-6">
          <SubtaskList
            taskId={task.id}
            readOnly={readOnly}
            onCountsChange={onSubtaskCountsChange}
          />
          <Tabs defaultValue="comments">
            <TabsList className="w-full">
              <TabsTrigger value="comments">Comments</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>
            <TabsContent value="comments">
              {" "}
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
            </TabsContent>
            <TabsContent value="activity">
              <TaskActivity taskId={task.id} revision={commentRevision} />
            </TabsContent>
          </Tabs>
        </div>
        <div className="bg-background sticky bottom-0 z-10 flex flex-wrap justify-end gap-3 border-t p-4">
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
            <Button type="submit" form="task-details-form" disabled={pending}>
              {pending ? "Saving" : "Save changes"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
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

function SubtaskList({
  taskId,
  readOnly,
  onCountsChange,
}: {
  taskId: string;
  readOnly: boolean;
  onCountsChange?: (done: number, total: number) => void;
}) {
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

  function commit(next: Subtask[]) {
    setSubtasks(next);
    onCountsChange?.(next.filter((subtask) => subtask.is_completed).length, next.length);
  }

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
      commit([...subtasks, payload.data]);
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
      commit(subtasks.map((item) => (item.id === subtask.id ? payload.data : item)));
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
      commit(subtasks.filter((item) => item.id !== subtask.id));
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
                aria-label={`Subtask title: ${subtask.title}`}
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
            aria-label="New subtask title"
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

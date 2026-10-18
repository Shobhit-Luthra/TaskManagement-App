"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, LoaderCircle, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MAX_ATTACHMENTS_PER_TASK,
  createTaskAttachmentSchema,
  formatFileSize,
  type TaskAttachment,
} from "@/lib/attachments/schemas";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "task-attachments";

export function TaskAttachments({
  taskId,
  currentUserId,
  currentUserRole,
  readOnly,
  onCountChange,
}: {
  taskId: string;
  currentUserId: string;
  currentUserRole: "owner" | "admin" | "member" | "viewer";
  readOnly: boolean;
  onCountChange?: (count: number) => void;
}) {
  const [files, setFiles] = useState<TaskAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/tasks/${taskId}/attachments`)
      .then(async (response) => {
        const payload = (await response.json()) as { data?: unknown };
        if (!response.ok || !Array.isArray(payload.data)) throw new Error("Load rejected");
        if (active) setFiles(payload.data as TaskAttachment[]);
      })
      .catch(() => active && setError("Attachments could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [taskId]);

  function commit(next: TaskAttachment[]) {
    setFiles(next);
    onCountChange?.(next.length);
  }

  async function removeRegistered(attachmentId: string) {
    await fetch(`/api/v1/tasks/${taskId}/attachments/${attachmentId}`, { method: "DELETE" });
  }

  async function uploadAll(picked: File[]) {
    if (picked.length === 0) return;
    setError(null);
    setUploading(true);
    let next = files;
    try {
      for (const file of picked) {
        if (next.length >= MAX_ATTACHMENTS_PER_TASK) {
          setError(`A task can have at most ${MAX_ATTACHMENTS_PER_TASK} files.`);
          break;
        }
        const parsed = createTaskAttachmentSchema.safeParse({
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        });
        if (!parsed.success) {
          setError(`${file.name}: ${parsed.error.issues[0]?.message ?? "Check the file."}`);
          continue;
        }
        const response = await fetch(`/api/v1/tasks/${taskId}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        });
        const payload = (await response.json()) as {
          data?: TaskAttachment;
          error?: { message?: string };
        };
        if (!response.ok || !payload.data) {
          setError(payload.error?.message ?? `${file.name} could not be attached.`);
          continue;
        }
        const { error: uploadError } = await createClient()
          .storage.from(BUCKET)
          .upload(payload.data.storage_path, file, { contentType: file.type, upsert: false });
        if (uploadError) {
          await removeRegistered(payload.data.id);
          setError(`${file.name} could not be uploaded. Try again.`);
          continue;
        }
        next = [...next, payload.data];
        commit(next);
      }
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function download(file: TaskAttachment) {
    setError(null);
    setPendingId(file.id);
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/attachments/${file.id}`);
      const payload = (await response.json()) as { data?: { url?: string } };
      if (!response.ok || !payload.data?.url) throw new Error("Download rejected");
      window.location.assign(payload.data.url);
    } catch {
      setError(`${file.file_name} could not be downloaded. Try again.`);
    } finally {
      setPendingId(null);
    }
  }

  async function remove(file: TaskAttachment) {
    setError(null);
    setPendingId(file.id);
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/attachments/${file.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Delete rejected");
      commit(files.filter((item) => item.id !== file.id));
    } catch {
      setError("File could not be removed. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  const canManageAll = currentUserRole === "owner" || currentUserRole === "admin";
  return (
    <section className="space-y-3 border-t pt-5" aria-labelledby="attachments-title">
      <h3 id="attachments-title" className="font-medium">
        Attachments
      </h3>
      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" /> Loading attachments
        </div>
      ) : (
        <ul aria-label="Attachments" className="space-y-1.5">
          {files.map((file) => {
            const canRemove = !readOnly && (canManageAll || file.created_by === currentUserId);
            return (
              <li
                key={file.id}
                className="hover:bg-muted/60 flex items-center gap-2 rounded-md px-1 py-1.5"
              >
                <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => void download(file)}
                  disabled={pendingId === file.id}
                  className="focus-visible:ring-ring min-w-0 flex-1 rounded text-left text-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="block truncate font-medium">{file.file_name}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {formatFileSize(file.size_bytes)}
                  </span>
                </button>
                {canRemove && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${file.file_name}`}
                    disabled={pendingId === file.id}
                    onClick={() => void remove(file)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!loading && files.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Attach files to this task: images, PDFs, Office documents, CSV or zip, up to 10 MB each.
        </p>
      )}
      {!readOnly && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void uploadAll(Array.from(event.dataTransfer.files));
          }}
          className={`flex items-center gap-3 rounded-md border border-dashed p-3 text-sm ${
            dragging ? "bg-muted/60 border-foreground/40" : ""
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            aria-label="Choose files to attach"
            onChange={(event) => void uploadAll(Array.from(event.target.files ?? []))}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Paperclip className="size-4" aria-hidden="true" />
            )}
            {uploading ? "Uploading" : "Attach files"}
          </Button>
          <span className="text-muted-foreground">or drop files here</span>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </section>
  );
}

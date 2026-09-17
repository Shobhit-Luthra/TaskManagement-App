"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CommentBody } from "@/lib/comments/markdown";
import { MentionAutocomplete, type PeerOption } from "./mention-autocomplete";

export type CommentRow = {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  mentioned_user_ids: string[];
  created_at: string;
  updated_at: string;
};

const DRAFT_STORAGE_PREFIX = "kanbo:comment-draft:";

export function CommentThread({
  taskId,
  currentUserId,
  currentUserRole,
  readOnly,
  peers,
  refreshVersion = 0,
}: {
  taskId: string;
  projectId: string;
  currentUserId: string;
  currentUserRole: "owner" | "admin" | "member" | "viewer";
  readOnly: boolean;
  peers: PeerOption[];
  refreshVersion?: number;
}) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(() => {
    try {
      return typeof window === "undefined"
        ? ""
        : (sessionStorage.getItem(DRAFT_STORAGE_PREFIX + taskId) ?? "");
    } catch {
      return "";
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const canModerate = currentUserRole === "owner" || currentUserRole === "admin";

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/v1/tasks/${taskId}/comments`)
      .then(async (response) => {
        if (!response.ok) throw new Error("comments unavailable");
        return (await response.json()) as { data?: CommentRow[] };
      })
      .then((payload) => {
        if (!cancelled) setComments(payload.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Comments could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, refreshVersion]);

  useEffect(() => {
    try {
      if (draft) sessionStorage.setItem(DRAFT_STORAGE_PREFIX + taskId, draft);
      else sessionStorage.removeItem(DRAFT_STORAGE_PREFIX + taskId);
    } catch {
      // Storage persistence is best effort.
    }
  }, [draft, taskId]);

  async function post() {
    if (!draft.trim()) return;
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft.trim(), mentionedUserIds: [] }),
      });
      const payload = (await response.json()) as {
        data?: CommentRow;
        error?: { message?: string };
      };
      if (!response.ok || !payload.data) {
        setError(payload.error?.message ?? "Your comment could not be posted. Please try again.");
        return;
      }
      setComments((current) => [...current, payload.data!]);
      setDraft("");
    } catch {
      setError("You appear to be offline. Your draft is still here—try again when connected.");
    } finally {
      setPending(false);
    }
  }

  async function remove(commentId: string) {
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/comments/${commentId}`, {
        method: "DELETE",
      });
      if (response.ok)
        setComments((current) => current.filter((comment) => comment.id !== commentId));
    } catch {
      setError("Comment could not be deleted. Try again.");
    }
  }

  async function saveEdit(comment: CommentRow, overwrite = false) {
    if (!editDraft.trim()) return;
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/comments/${comment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: editDraft.trim(),
          mentionedUserIds: [],
          expectedUpdatedAt: comment.updated_at,
        }),
      });
      const payload = (await response.json()) as {
        data?: CommentRow;
        error?: { message?: string; details?: { current?: CommentRow } };
      };
      if (response.status === 409 && payload.error?.details?.current && !overwrite) {
        setComments((current) =>
          current.map((item) => (item.id === comment.id ? payload.error!.details!.current! : item)),
        );
        setError("This comment changed elsewhere. Review the latest version, then edit it again.");
        setEditingCommentId(null);
        return;
      }
      if (!response.ok || !payload.data) {
        setError(payload.error?.message ?? "Your comment could not be updated. Please try again.");
        return;
      }
      setComments((current) =>
        current.map((item) => (item.id === comment.id ? payload.data! : item)),
      );
      setEditingCommentId(null);
      setEditDraft("");
    } catch {
      setError("You appear to be offline. Your edit is still here—try again when connected.");
    } finally {
      setPending(false);
    }
  }

  const allowedMentionIds = new Set(peers.map((peer) => peer.userId));
  const resolveDisplayName = (id: string) =>
    peers.find((peer) => peer.userId === id)?.displayName ?? null;
  return (
    <section className="space-y-4 border-t pt-4" aria-labelledby={`comments-${taskId}`}>
      <h3 id={`comments-${taskId}`} className="text-sm font-medium">
        Comments
      </h3>
      {loading ? (
        <p className="text-muted-foreground text-sm">Loading comments…</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li
              key={comment.id}
              data-comment-id={comment.id}
              className="rounded-md border p-3 text-sm"
            >
              {editingCommentId === comment.id ? (
                <div className="space-y-2">
                  <MentionAutocomplete
                    peers={peers}
                    textareaId={`edit-comment-${comment.id}`}
                    ariaLabel="Edit comment"
                    value={editDraft}
                    onChange={setEditDraft}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void saveEdit(comment)}
                      disabled={pending || !editDraft.trim()}
                    >
                      {pending ? "Saving" : "Save"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingCommentId(null);
                        setEditDraft("");
                      }}
                      disabled={pending}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <CommentBody
                  body={comment.body}
                  allowedMentionIds={allowedMentionIds}
                  resolveDisplayName={resolveDisplayName}
                />
              )}
              <div className="mt-2 flex gap-2">
                {comment.author_id === currentUserId && editingCommentId !== comment.id && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingCommentId(comment.id);
                      setEditDraft(comment.body);
                    }}
                  >
                    Edit
                  </Button>
                )}
                {(comment.author_id === currentUserId || canModerate) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void remove(comment.id)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="space-y-2">
          <MentionAutocomplete
            peers={peers}
            textareaId={`comment-${taskId}`}
            value={draft}
            onChange={setDraft}
          />
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <Button type="button" onClick={() => void post()} disabled={pending || !draft.trim()}>
            {pending ? "Posting" : "Post"}
          </Button>
        </div>
      )}
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Notification = {
  id: string;
  project_id: string;
  task_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

// G14: canonical deep link — the board route opens the task modal from ?task=.
function deepLink(n: Notification): string {
  return n.task_id ? `/p/${n.project_id}/board?task=${n.task_id}` : `/p/${n.project_id}/board`;
}

function describe(n: Notification): string {
  const title = String(n.payload.taskTitle ?? "a task");
  switch (n.type) {
    case "task_assigned":
      return `You were assigned "${title}"`;
    case "task_unassigned":
      return `You were unassigned from "${title}"`;
    case "mentioned":
      return `You were mentioned on "${title}"`;
    case "status_changed":
      return `"${title}" changed status`;
    case "due_soon":
      return `"${title}" is due soon`;
    case "digest_ready":
      return "This week's digest is ready";
    default:
      return title;
  }
}

export function NotificationList({
  onAllRead,
  onClose,
}: {
  onAllRead: () => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/notifications")
      .then((res) => res.json())
      .then((body) => setItems(body.data ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  async function markAllRead() {
    await fetch("/api/v1/notifications/read-all", { method: "POST" });
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    onAllRead();
  }

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="bg-popover absolute top-full right-0 z-50 mt-2 w-80 rounded-md border shadow-lg"
    >
      <div className="flex items-center justify-between border-b p-2">
        <span className="text-sm font-medium">Notifications</span>
        <button onClick={markAllRead} className="text-muted-foreground text-xs hover:underline">
          Mark all read
        </button>
      </div>
      <ul className="max-h-96 overflow-y-auto">
        {loading && <li className="text-muted-foreground p-3 text-sm">Loading…</li>}
        {!loading && items.length === 0 && (
          <li className="text-muted-foreground p-3 text-sm">No notifications yet.</li>
        )}
        {items.map((n) => (
          <li key={n.id} className={n.read_at ? "" : "bg-accent/40"}>
            <Link href={deepLink(n)} onClick={onClose} className="hover:bg-muted block p-3 text-sm">
              {describe(n)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

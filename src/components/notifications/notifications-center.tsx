"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Check, MessageCircle, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

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
  if (n.type === "join_requested") return `/p/${n.project_id}/settings/members`;
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
    case "join_requested":
      return `${String(n.payload.requesterName ?? "Someone")} asked to join ${String(n.payload.projectName ?? "your board")}`;
    default:
      return title;
  }
}

export function NotificationsCenter({
  onRead,
  onClose,
  revision,
}: {
  onRead: (count: number) => void;
  onClose: () => void;
  revision: number;
}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/notifications", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (!Array.isArray(body.data)) throw new Error();
        if (!controller.signal.aborted) {
          setItems(body.data);
          setError(null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Notifications could not be loaded. Try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, retry]);

  async function markRead(id?: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    const unreadIds = new Set(
      items.filter((n) => !n.read_at && (!id || n.id === id)).map((n) => n.id),
    );
    try {
      const response = await fetch(
        id ? `/api/v1/notifications/${id}/read` : "/api/v1/notifications/read-all",
        { method: "POST" },
      );
      if (!response.ok) throw new Error();
      setItems((current) =>
        current.map((n) => (unreadIds.has(n.id) ? { ...n, read_at: new Date().toISOString() } : n)),
      );
      onRead(unreadIds.size);
    } catch {
      setError("Notifications could not be marked as read. Try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  const unread = items.filter((item) => !item.read_at).length;
  return (
    <SheetContent className="w-full gap-0 sm:max-w-[460px]">
      <SheetHeader className="border-b p-6 pr-12">
        <SheetTitle className="text-headline-md font-serif font-medium">Notifications</SheetTitle>
        <SheetDescription>Updates from your projects and teammates.</SheetDescription>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="bg-secondary text-secondary-foreground rounded-full px-3 py-1 text-xs font-medium">
            {unread} unread
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || unread === 0}
            onClick={() => void markRead()}
          >
            Mark all read
          </Button>
        </div>
      </SheetHeader>
      {error && (
        <div role="alert" className="text-destructive px-6 pt-4 text-sm">
          {error}
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            onClick={() => setRetry((value) => value + 1)}
          >
            Reload
          </Button>
        </div>
      )}
      <Tabs defaultValue="all" className="min-h-0 flex-1 gap-0">
        <TabsList className="mx-6 my-4 grid w-auto grid-cols-4">
          {["all", "unread", "mentions", "assigned"].map((filter) => (
            <TabsTrigger key={filter} value={filter} className="capitalize">
              {filter[0]!.toUpperCase() + filter.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>
        {["all", "unread", "mentions", "assigned"].map((filter) => {
          const visible = items.filter(
            (n) =>
              filter === "all" ||
              (filter === "unread" && !n.read_at) ||
              (filter === "mentions" && n.type === "mentioned") ||
              (filter === "assigned" && n.type === "task_assigned"),
          );
          return (
            <TabsContent key={filter} value={filter} className="min-h-0 overflow-y-auto px-4 pb-6">
              {loading ? (
                <p role="status" className="text-muted-foreground p-4 text-sm">
                  Loading notifications…
                </p>
              ) : (
                <ul className="space-y-2">
                  {visible.length === 0 && (
                    <li className="text-muted-foreground px-4 py-12 text-center text-sm">
                      <Bell className="mx-auto mb-3 size-6" aria-hidden="true" />
                      {filter === "all" ? "No notifications yet." : `No ${filter} notifications.`}
                    </li>
                  )}
                  {visible.map((n) => {
                    const Icon =
                      n.type === "mentioned"
                        ? MessageCircle
                        : n.type === "task_assigned"
                          ? UserCheck
                          : Bell;
                    return (
                      <li
                        key={n.id}
                        className={cn(
                          "flex gap-3 rounded-lg p-4",
                          !n.read_at
                            ? "bg-secondary/60 border-brand-primary border-l"
                            : "hover:bg-surface-low",
                        )}
                      >
                        <span className="bg-card text-brand-primary mt-1 flex size-9 shrink-0 items-center justify-center rounded-full">
                          <Icon className="size-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <Link
                            href={deepLink(n)}
                            onClick={onClose}
                            className="block text-sm leading-relaxed break-words hover:underline"
                          >
                            {describe(n)}
                          </Link>
                          <time
                            dateTime={n.created_at}
                            className="text-muted-foreground mt-2 block text-xs"
                          >
                            {new Intl.DateTimeFormat(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }).format(new Date(n.created_at))}
                          </time>
                          {!n.read_at && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="mt-2"
                              disabled={pending}
                              onClick={() => void markRead(n.id)}
                            >
                              <Check className="size-3" />
                              Mark as read<span className="sr-only">: {describe(n)}</span>
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
      <p className="text-muted-foreground border-t p-4 text-center text-xs">
        Your latest 50 notifications
      </p>
    </SheetContent>
  );
}

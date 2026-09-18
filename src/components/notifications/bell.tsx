"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useNotificationChannel } from "@/lib/realtime/use-notification-channel";
import { NotificationList } from "./notification-list";

export function NotificationBell({ userId }: { userId: string }) {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/v1/notifications")
      .then((res) => res.json())
      .then((body) => {
        const items = (body.data ?? []) as { read_at: string | null }[];
        setUnread(items.filter((n) => !n.read_at).length);
      })
      .catch(() => {});
  }, []);

  useNotificationChannel(userId, () => setUnread((n) => n + 1));

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-muted relative rounded-full p-2"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="bg-destructive text-destructive-foreground absolute -top-0.5 -right-0.5 rounded-full px-1 text-xs">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && <NotificationList onAllRead={() => setUnread(0)} onClose={() => setOpen(false)} />}
    </div>
  );
}

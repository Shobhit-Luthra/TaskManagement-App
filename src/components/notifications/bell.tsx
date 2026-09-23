"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useNotificationChannel } from "@/lib/realtime/use-notification-channel";
import { NotificationsCenter } from "./notifications-center";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";

export function NotificationBell({ userId }: { userId: string }) {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    fetch("/api/v1/notifications")
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((body) => {
        const items = (body.data ?? []) as { read_at: string | null }[];
        setUnread(items.filter((n) => !n.read_at).length);
      })
      .catch(() => {});
  }, []);

  useNotificationChannel(userId, () => {
    setUnread((n) => n + 1);
    setRevision((value) => value + 1);
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          className="hover:bg-muted relative rounded-full p-2"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 rounded-full px-1 text-xs">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </SheetTrigger>
      {open && (
        <NotificationsCenter
          revision={revision}
          onRead={(count) => setUnread((value) => Math.max(0, value - count))}
          onClose={() => setOpen(false)}
        />
      )}
    </Sheet>
  );
}

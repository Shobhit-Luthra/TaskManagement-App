"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type SyncStatus = "connecting" | "connected" | "reconnecting";

/**
 * Mirrors use-project-channel.ts's shape but scoped to one user's own
 * notifications instead of one project's tasks/columns — the bell needs a
 * cross-project unread count, not a per-project one.
 */
export function useNotificationChannel(userId: string | null, onInsert: () => void): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>("connecting");
  const onInsertRef = useRef(onInsert);

  useEffect(() => {
    onInsertRef.current = onInsert;
  });

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => onInsertRef.current(),
      )
      .subscribe((channelStatus) => {
        if (channelStatus === "SUBSCRIBED") setStatus("connected");
        else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(channelStatus))
          setStatus("reconnecting");
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return status;
}

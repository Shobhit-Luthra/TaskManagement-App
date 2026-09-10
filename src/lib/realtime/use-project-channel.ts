"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { ChangeEvent, ColumnRow, TaskRow } from "./board-sync";

export type SyncStatus = "connecting" | "connected" | "reconnecting";

type ProjectChannelHandlers = {
  onTask: (event: ChangeEvent<TaskRow>) => void;
  onColumn: (event: ChangeEvent<ColumnRow>) => void;
};

function normalize<Row>(
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
): ChangeEvent<Row> {
  if (payload.eventType === "DELETE") {
    return { type: "DELETE", old: { id: (payload.old as { id?: string }).id } };
  }
  return { type: payload.eventType, row: payload.new as Row };
}

/**
 * Subscribes to task and column changes for one project over a single Supabase
 * Realtime channel. Row visibility is enforced by RLS. Returns the connection
 * status so the board can surface a reconnect banner and degrade to read-only.
 */
export function useProjectChannel(projectId: string, handlers: ProjectChannelHandlers): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>("connecting");
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const supabase = createClient();
    const filter = `project_id=eq.${projectId}`;
    const channel = supabase
      .channel(`project:${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter }, (payload) =>
        handlersRef.current.onTask(normalize<TaskRow>(payload)),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "columns", filter },
        (payload) => handlersRef.current.onColumn(normalize<ColumnRow>(payload)),
      )
      .subscribe((channelStatus) => {
        if (channelStatus === "SUBSCRIBED") setStatus("connected");
        else if (
          channelStatus === "CHANNEL_ERROR" ||
          channelStatus === "TIMED_OUT" ||
          channelStatus === "CLOSED"
        ) {
          setStatus("reconnecting");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId]);

  return status;
}

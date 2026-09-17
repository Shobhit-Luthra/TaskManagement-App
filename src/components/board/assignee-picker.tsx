"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Peer = { id: string; display_name: string };

export function AssigneePicker({
  projectId,
  value,
  onChange,
  disabled,
}: {
  projectId: string;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled: boolean;
}) {
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    let mounted = true;
    void createClient()
      .from("project_peers")
      .select("id, display_name")
      .order("display_name")
      .then(({ data }) => {
        if (mounted) setPeers((data as Peer[] | null) ?? []);
      });
    return () => {
      mounted = false;
    };
  }, [projectId]);

  return (
    <label className="block space-y-2 text-sm font-medium">
      Assignee
      <select
        aria-label="Assignee"
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
        className="bg-background focus-visible:ring-ring/40 w-full rounded-md border px-3 py-2 text-base font-normal outline-none focus-visible:ring-2"
      >
        <option value="">Unassigned</option>
        {peers.map((peer) => (
          <option key={peer.id} value={peer.id}>
            {peer.display_name}
          </option>
        ))}
      </select>
    </label>
  );
}

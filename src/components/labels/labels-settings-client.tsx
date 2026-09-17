"use client";

import { useCallback, useEffect, useState } from "react";
import { LabelsSettings, type LabelRow } from "./labels-settings";

async function messageFor(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return payload?.error?.message ?? fallback;
}

async function fetchLabels(projectId: string): Promise<LabelRow[]> {
  const response = await fetch(`/api/v1/projects/${projectId}/labels`);
  if (!response.ok) throw new Error(await messageFor(response, "Labels could not be loaded."));
  const payload = (await response.json()) as { data: LabelRow[] };
  return payload.data;
}

export function LabelsSettingsClient({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const [labels, setLabels] = useState<LabelRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const load = useCallback(async () => {
    setStatus("loading");
    setLabels(await fetchLabels(projectId));
    setStatus("ready");
  }, [projectId]);
  useEffect(() => {
    let active = true;
    fetchLabels(projectId)
      .then((nextLabels) => {
        if (!active) return;
        setLabels(nextLabels);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "Labels could not be loaded.");
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  async function create(input: { name: string; color: string }) {
    setMessage(null);
    const response = await fetch(`/api/v1/projects/${projectId}/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      setMessage(await messageFor(response, "Label could not be created."));
      return;
    }
    await load();
  }
  async function remove(labelId: string) {
    setMessage(null);
    const response = await fetch(`/api/v1/projects/${projectId}/labels/${labelId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setMessage(await messageFor(response, "Label could not be deleted."));
      return;
    }
    await load();
  }
  async function update(labelId: string, input: { name: string; color: string }) {
    setMessage(null);
    const response = await fetch(`/api/v1/projects/${projectId}/labels/${labelId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      setMessage(await messageFor(response, "Label could not be updated."));
      return;
    }
    await load();
  }
  if (status === "loading")
    return <p className="text-muted-foreground mt-8 text-sm">Loading labels…</p>;
  if (status === "error")
    return (
      <p role="alert" className="text-destructive mt-8 text-sm">
        {message}
      </p>
    );
  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold">Labels</h2>
      {message && (
        <p role="status" className="text-muted-foreground mt-2 text-sm">
          {message}
        </p>
      )}
      <div className="mt-4">
        <LabelsSettings
          labels={labels}
          canManage={canManage}
          onCreate={(input) => void create(input)}
          onUpdate={(id, input) => void update(id, input)}
          onDelete={(id) => void remove(id)}
        />
      </div>
    </div>
  );
}

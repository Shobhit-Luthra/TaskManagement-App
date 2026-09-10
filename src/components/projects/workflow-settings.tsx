"use client";

import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Column = {
  id: string;
  name: string;
  position: number;
  wip_limit: number | null;
  is_done_column: boolean;
  is_in_progress_column: boolean;
};

export function WorkflowSettings({
  projectId,
  initialColumns,
}: {
  projectId: string;
  initialColumns: Column[];
}) {
  const [columns, setColumns] = useState(initialColumns);
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  async function save(
    column: Column,
    values: Pick<Column, "name" | "wip_limit" | "is_done_column">,
  ) {
    setPending(column.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/columns/${column.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          wipLimit: values.wip_limit,
          isDoneColumn: values.is_done_column,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isColumn(payload)) throw new Error();
      setColumns((current) =>
        current.map((item) =>
          item.id === column.id
            ? payload.data
            : payload.data.is_done_column
              ? { ...item, is_done_column: false }
              : item,
        ),
      );
      setMessage("Workflow saved.");
    } catch {
      setMessage("Column could not be saved. Try again.");
    } finally {
      setPending(null);
    }
  }
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newName.trim()) return;
    setPending("new");
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/columns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isColumn(payload)) throw new Error();
      setColumns((current) => [...current, payload.data].sort((a, b) => a.position - b.position));
      setNewName("");
      setMessage("Column added.");
    } catch {
      setMessage("Column could not be added. Try again.");
    } finally {
      setPending(null);
    }
  }
  return (
    <section className="mt-8 border-t pt-8" aria-labelledby="workflow-title">
      <div>
        <h2 id="workflow-title" className="text-lg font-semibold">
          Workflow
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Shape the columns your team uses to move work forward.
        </p>
      </div>
      <div className="mt-5 space-y-3">
        {columns.map((column) => (
          <ColumnRow
            key={column.id}
            column={column}
            pending={pending === column.id}
            onSave={save}
          />
        ))}
      </div>
      <form className="mt-4 flex gap-2" onSubmit={(event) => void add(event)}>
        <Input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          maxLength={60}
          placeholder="New column name"
          aria-label="New column name"
        />
        <Button type="submit" disabled={!newName.trim() || pending === "new"}>
          <Plus />
          {pending === "new" ? "Adding" : "Add column"}
        </Button>
      </form>
      {message && (
        <p role="status" className="text-muted-foreground mt-3 text-sm">
          {message}
        </p>
      )}
    </section>
  );
}

function ColumnRow({
  column,
  pending,
  onSave,
}: {
  column: Column;
  pending: boolean;
  onSave: (
    column: Column,
    values: Pick<Column, "name" | "wip_limit" | "is_done_column">,
  ) => Promise<void>;
}) {
  const [name, setName] = useState(column.name),
    [wipLimit, setWipLimit] = useState(column.wip_limit?.toString() ?? ""),
    [done, setDone] = useState(column.is_done_column);
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSave(column, {
      name: name.trim(),
      wip_limit: wipLimit ? Number(wipLimit) : null,
      is_done_column: done,
    });
  }
  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_8rem_auto_auto] sm:items-end"
    >
      <label className="block text-sm font-medium">
        Column name
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          className="mt-1.5"
          required
        />
      </label>
      <label className="block text-sm font-medium">
        WIP limit
        <Input
          type="number"
          min="1"
          value={wipLimit}
          onChange={(event) => setWipLimit(event.target.value)}
          className="mt-1.5"
          placeholder="None"
        />
      </label>
      <label className="flex h-10 items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={done}
          onChange={(event) => setDone(event.target.checked)}
          className="accent-primary size-4"
        />
        Done column
      </label>
      <Button type="submit" variant="outline" disabled={pending || !name.trim()}>
        {pending ? (
          "Saving"
        ) : (
          <>
            <Check />
            Save
          </>
        )}
      </Button>
    </form>
  );
}

function isColumn(value: unknown): value is { data: Column } {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    typeof value.data === "object" &&
    value.data !== null &&
    "id" in value.data
  );
}

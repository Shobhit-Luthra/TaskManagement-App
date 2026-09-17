"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LabelChip } from "./label-chip";

export type LabelRow = { id: string; name: string; color: string; created_at: string };

const DEFAULT_COLOR = "#6366F1";

export function LabelsSettings({
  labels,
  canManage,
  onCreate,
  onUpdate,
  onDelete,
}: {
  labels: LabelRow[];
  canManage: boolean;
  onCreate: (input: { name: string; color: string }) => void;
  onUpdate: (id: string, input: { name: string; color: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <ul className="space-y-2" aria-label="Project labels">
        {labels.map((label) => (
          <li
            key={label.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
          >
            {editingId === label.id ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs">
                  Name
                  <Input
                    aria-label={`Name for ${label.name}`}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={50}
                  />
                </label>
                <label className="text-xs">
                  Colour
                  <input
                    aria-label={`Colour for ${label.name}`}
                    type="color"
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                    className="bg-background block h-10 w-16 rounded border"
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    if (name.trim()) onUpdate(label.id, { name: name.trim(), color });
                    setEditingId(null);
                  }}
                >
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingId(null)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <LabelChip name={label.name} color={label.color} />
            )}
            {canManage && editingId !== label.id && (
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditingId(label.id);
                    setName(label.name);
                    setColor(label.color);
                  }}
                >
                  Edit {label.name}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => onDelete(label.id)}>
                  Delete {label.name}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <form
          className="flex flex-wrap items-end gap-3 border-t pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            onCreate({ name: name.trim(), color });
            setName("");
            setColor(DEFAULT_COLOR);
          }}
        >
          <label className="block space-y-2 text-sm font-medium" htmlFor="new-label-name">
            Name
            <Input
              id="new-label-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={50}
            />
          </label>
          <label className="block space-y-2 text-sm font-medium" htmlFor="new-label-color">
            Colour
            <input
              id="new-label-color"
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="bg-background block h-10 w-16 rounded border"
            />
          </label>
          <Button type="submit">Add label</Button>
        </form>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DueFilter, FilterState } from "@/lib/filters/schema";
import type { LabelOption } from "@/components/labels/label-picker";
import type { PeerOption } from "./mention-autocomplete";

const priorities: FilterState["priority"] = ["low", "medium", "high", "urgent"];
const dueOptions: Array<{ value: DueFilter; label: string }> = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "week", label: "Due this week" },
  { value: "none", label: "No due date" },
];

export function FilterBar({
  filters,
  onChange,
  onClear,
  peers,
  labels,
}: {
  filters: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  onClear: () => void;
  peers: PeerOption[];
  labels: LabelOption[];
}) {
  const [open, setOpen] = useState<"assignee" | "label" | "priority" | null>(null);
  const hasFilters = Boolean(
    filters.q ||
    filters.assignee.length ||
    filters.label.length ||
    filters.priority.length ||
    filters.due,
  );
  function toggle(kind: "assignee" | "label" | "priority", id: string) {
    const values = filters[kind] as string[];
    onChange({
      [kind]: values.includes(id) ? values.filter((value) => value !== id) : [...values, id],
    } as Partial<FilterState>);
  }
  const labelFor = (kind: "assignee" | "label" | "priority", id: string) =>
    kind === "assignee"
      ? (peers.find((peer) => peer.userId === id)?.displayName ?? id)
      : kind === "label"
        ? (labels.find((label) => label.id === id)?.name ?? id)
        : id;
  return (
    <div className="bg-background flex flex-col gap-2 border-b px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 basis-full sm:flex-1 sm:basis-auto">
          <span className="sr-only">Search tasks</span>
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            value={filters.q}
            onChange={(event) => onChange({ q: event.target.value })}
            placeholder="Search tasks"
            className="bg-background placeholder:text-muted-foreground focus-visible:ring-ring/40 h-9 w-full rounded-md border py-2 pr-3 pl-9 text-base outline-none focus-visible:ring-2 sm:text-sm"
          />
        </label>
        {(["assignee", "label", "priority"] as const).map((kind) => (
          <div key={kind} className="relative">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={open === kind}
              onClick={() => setOpen(open === kind ? null : kind)}
            >
              {kind[0]!.toUpperCase() + kind.slice(1)}
              {filters[kind].length ? ` (${filters[kind].length})` : ""}
            </Button>
            {open === kind && (
              <div
                className="bg-card absolute z-20 mt-1 w-56 rounded-md border p-2 shadow-md"
                role="menu"
              >
                {kind === "assignee"
                  ? peers.map((peer) => (
                      <Choice
                        key={peer.userId}
                        checked={filters.assignee.includes(peer.userId)}
                        label={peer.displayName}
                        onChange={() => toggle(kind, peer.userId)}
                      />
                    ))
                  : kind === "label"
                    ? labels.map((label) => (
                        <Choice
                          key={label.id}
                          checked={filters.label.includes(label.id)}
                          label={label.name}
                          color={label.color}
                          onChange={() => toggle(kind, label.id)}
                        />
                      ))
                    : priorities.map((priority) => (
                        <Choice
                          key={priority}
                          checked={filters.priority.includes(priority)}
                          label={priority}
                          onChange={() => toggle(kind, priority)}
                        />
                      ))}
              </div>
            )}
          </div>
        ))}
        <label className="flex items-center gap-2 text-sm font-medium">
          <span className="text-muted-foreground">Due</span>
          <select
            value={filters.due ?? "all"}
            onChange={(event) =>
              onChange({
                due: event.target.value === "all" ? null : (event.target.value as DueFilter),
              })
            }
            className="bg-background h-9 rounded-md border px-2 text-sm font-normal"
          >
            <option value="all">Any</option>
            {dueOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {hasFilters && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X /> Clear filters
          </Button>
        )}
      </div>
      {hasFilters && (
        <div className="flex flex-wrap gap-1.5" aria-label="Active filters">
          {(["assignee", "label", "priority"] as const).flatMap((kind) =>
            filters[kind].map((id) => (
              <Chip
                key={`${kind}-${id}`}
                label={labelFor(kind, id)}
                onRemove={() => toggle(kind, id)}
              />
            )),
          )}
          {filters.due && (
            <Chip
              label={
                dueOptions.find((option) => option.value === filters.due)?.label ?? filters.due
              }
              onRemove={() => onChange({ due: null })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Choice({
  checked,
  label,
  color,
  onChange,
}: {
  checked: boolean;
  label: string;
  color?: string;
  onChange: () => void;
}) {
  return (
    <label className="hover:bg-muted flex items-center gap-2 rounded px-2 py-1.5 text-sm capitalize">
      <input type="checkbox" checked={checked} onChange={onChange} />
      {color && (
        <span
          className="size-2.5 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      )}
      {label}
    </label>
  );
}
function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="bg-muted inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium capitalize">
      {label}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="hover:text-destructive rounded-full"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

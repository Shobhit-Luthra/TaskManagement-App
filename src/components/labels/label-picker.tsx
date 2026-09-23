"use client";

export type LabelOption = { id: string; name: string; color: string };

export function LabelPicker({
  labels,
  selectedIds,
  onChange,
  readOnly,
}: {
  labels: LabelOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  readOnly: boolean;
}) {
  function toggle(id: string) {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id],
    );
  }
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Labels</legend>
      {labels.length === 0 && (
        <p className="text-muted-foreground text-sm">No labels in this project.</p>
      )}
      <div className="flex flex-wrap gap-3">
        {labels.map((label) => (
          <label key={label.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label={label.name}
              checked={selectedIds.includes(label.id)}
              disabled={readOnly}
              onChange={() => toggle(label.id)}
            />
            <span style={{ color: label.color }}>{label.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

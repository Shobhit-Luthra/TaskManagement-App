export type ColumnBreakdownRow = {
  columnId: string;
  name: string;
  isDone: boolean;
  taskCount: number;
};

// Fixed categorical order; columns past the sixth fold into "Other" rather
// than cycling back to slot 1.
const MAX_SLOTS = 6;
const OTHER_COLOR = "var(--status-neutral-fg)";

export function progressPercent(rows: ColumnBreakdownRow[]): number {
  const total = rows.reduce((sum, row) => sum + row.taskCount, 0);
  if (total === 0) return 0;
  const done = rows.filter((row) => row.isDone).reduce((sum, row) => sum + row.taskCount, 0);
  return Math.round((done / total) * 100);
}

type Segment = { key: string; name: string; count: number; color: string };

function segmentsFor(rows: ColumnBreakdownRow[]): Segment[] {
  const segments: Segment[] = rows.slice(0, MAX_SLOTS).map((row, index) => ({
    key: row.columnId,
    name: row.name,
    count: row.taskCount,
    color: `var(--color-chart-${index + 1})`,
  }));
  const rest = rows.slice(MAX_SLOTS);
  if (rest.length > 0) {
    segments.push({
      key: "other",
      name: `Other (${rest.length} columns)`,
      count: rest.reduce((sum, row) => sum + row.taskCount, 0),
      color: OTHER_COLOR,
    });
  }
  return segments;
}

export function ProgressOverview({ rows }: { rows: ColumnBreakdownRow[] }) {
  const total = rows.reduce((sum, row) => sum + row.taskCount, 0);
  const done = rows.filter((row) => row.isDone).reduce((sum, row) => sum + row.taskCount, 0);
  const percent = progressPercent(rows);
  const segments = segmentsFor(rows);

  return (
    <section aria-labelledby="progress-heading" className="bg-card rounded-xl border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="progress-heading" className="text-sm font-semibold">
          Overall progress
        </h2>
        <p className="text-muted-foreground text-sm">
          {done} of {total} tasks done
        </p>
      </div>
      {total === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">
          No tasks yet. Progress appears once work is added.
        </p>
      ) : (
        <>
          <p className="mt-3 text-4xl font-semibold tabular-nums">{percent}%</p>
          <div
            role="progressbar"
            aria-label="Tasks done"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="bg-muted mt-3 h-3 overflow-hidden rounded-full"
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${percent}%`, background: "var(--color-chart-1)" }}
            />
          </div>

          <h3 className="text-muted-foreground mt-6 text-xs font-medium">Tasks by column</h3>
          <div className="mt-2 flex h-4 gap-[2px]" aria-hidden="true">
            {segments
              .filter((segment) => segment.count > 0)
              .map((segment) => (
                <div
                  key={segment.key}
                  title={`${segment.name}: ${segment.count}`}
                  className="h-full rounded-[4px] transition-opacity hover:opacity-80"
                  style={{ flexGrow: segment.count, background: segment.color }}
                />
              ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Tasks by column">
            {segments.map((segment) => (
              <li key={segment.key} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full"
                  style={{ background: segment.color }}
                />
                <span>{segment.name}</span>
                <span className="text-muted-foreground tabular-nums">{segment.count}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

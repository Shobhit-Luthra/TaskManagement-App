export type BreakdownRow = {
  dimension: "priority" | "label";
  key: string;
  name: string;
  color: string | null;
  openCount: number;
  doneCount: number;
};

const PRIORITY_ORDER = ["urgent", "high", "medium", "low"];
const MAX_LABELS = 10;
// Same slots as the rest of the dashboard: open = 2, done = 1.
const OPEN_COLOR = "var(--color-chart-2)";
const DONE_COLOR = "var(--color-chart-1)";

export function orderPriorityRows(rows: BreakdownRow[]): BreakdownRow[] {
  return rows
    .filter((row) => row.dimension === "priority")
    .sort((a, b) => PRIORITY_ORDER.indexOf(a.key) - PRIORITY_ORDER.indexOf(b.key));
}

function Bars({ title, rows, hidden }: { title: string; rows: BreakdownRow[]; hidden?: number }) {
  const max = Math.max(1, ...rows.map((row) => row.openCount + row.doneCount));
  return (
    <div>
      <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
      <table className="mt-2 w-full text-sm">
        <caption className="sr-only">{title}: open and done tasks</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">{title}</th>
            <th scope="col">Open and done</th>
            <th scope="col">Open</th>
            <th scope="col">Done</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="w-28 py-1.5 pr-3 text-left font-normal">
                <span className="flex items-center gap-2">
                  {row.color && (
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: row.color }}
                    />
                  )}
                  <span className="truncate">{row.name}</span>
                </span>
              </th>
              <td className="py-1.5" aria-hidden="true">
                <div className="flex h-3 gap-[2px]">
                  {row.openCount > 0 && (
                    <div
                      title={`${row.name}: ${row.openCount} open`}
                      className="rounded-[4px]"
                      style={{ width: `${(row.openCount / max) * 100}%`, background: OPEN_COLOR }}
                    />
                  )}
                  {row.doneCount > 0 && (
                    <div
                      title={`${row.name}: ${row.doneCount} done`}
                      className="rounded-[4px]"
                      style={{ width: `${(row.doneCount / max) * 100}%`, background: DONE_COLOR }}
                    />
                  )}
                </div>
              </td>
              <td className="text-muted-foreground w-24 py-1.5 pl-3 text-right text-xs tabular-nums">
                {row.openCount} open
              </td>
              <td className="text-muted-foreground w-20 py-1.5 pl-2 text-right text-xs tabular-nums">
                {row.doneCount} done
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!!hidden && (
        <p className="text-muted-foreground mt-1 text-xs">
          and {hidden} more {hidden === 1 ? "label" : "labels"}
        </p>
      )}
    </div>
  );
}

export function BreakdownChart({ rows }: { rows: BreakdownRow[] }) {
  const priorities = orderPriorityRows(rows);
  const labels = rows.filter((row) => row.dimension === "label");
  return (
    <section aria-labelledby="breakdown-heading" className="bg-card rounded-xl border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="breakdown-heading" className="text-sm font-semibold">
          By priority and label
        </h2>
        <ul className="flex gap-4 text-xs" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ background: OPEN_COLOR }}
            />
            Open
          </li>
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ background: DONE_COLOR }}
            />
            Done
          </li>
        </ul>
      </div>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <Bars title="Priority" rows={priorities} />
        {labels.length === 0 ? (
          <div>
            <h3 className="text-muted-foreground text-xs font-medium">Label</h3>
            <p className="text-muted-foreground mt-2 text-sm">This board has no labels yet.</p>
          </div>
        ) : (
          <Bars
            title="Label"
            rows={labels.slice(0, MAX_LABELS)}
            hidden={Math.max(0, labels.length - MAX_LABELS)}
          />
        )}
      </div>
    </section>
  );
}

"use client";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { InsufficientDataCard } from "./insufficient-data-card";

export type FlowRow = {
  snapshotDate: string;
  columnId: string;
  columnName: string;
  taskCount: number;
};

export function CumulativeFlowChart({ data }: { data: FlowRow[] }) {
  if (data.length === 0) return <InsufficientDataCard minWeeks={1} />;

  const dates = [...new Set(data.map((row) => row.snapshotDate))].sort();
  const gaps: string[] = [];
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]!);
    const next = new Date(dates[i]!);
    const dayMs = 86_400_000;
    for (let d = prev.getTime() + dayMs; d < next.getTime(); d += dayMs) {
      gaps.push(new Date(d).toISOString().slice(0, 10));
    }
  }

  const columns = [...new Set(data.map((row) => row.columnName))];
  const byDate = new Map<string, Record<string, number>>();
  for (const row of data) {
    const entry = byDate.get(row.snapshotDate) ?? {};
    entry[row.columnName] = row.taskCount;
    byDate.set(row.snapshotDate, entry);
  }
  const chartData = dates.map((date) => ({ snapshotDate: date, ...byDate.get(date) }));

  return (
    <div>
      <p className="sr-only">
        Cumulative flow across {columns.length} columns and {dates.length} snapshot days.
        {gaps.length > 0
          ? ` Gap on ${gaps.join(", ")} — no snapshot was recorded, shown as a break, never interpolated.`
          : ""}
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={chartData}>
          <XAxis dataKey="snapshotDate" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} />
          <Tooltip />
          {columns.map((name, index) => (
            <Area
              key={name}
              type="monotone"
              dataKey={name}
              stackId="1"
              stroke={`var(--color-chart-${(index % 5) + 1}, #6366f1)`}
              fill={`var(--color-chart-${(index % 5) + 1}, #6366f1)`}
              connectNulls={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

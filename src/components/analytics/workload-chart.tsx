"use client";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { InsufficientDataCard } from "./insufficient-data-card";

export type WorkloadRow = {
  memberUserId: string;
  displayName: string;
  openCount: number;
  doneCount: number;
};

export function WorkloadChart({ data }: { data: WorkloadRow[] }) {
  if (data.length === 0) return <InsufficientDataCard minWeeks={0} />;
  return (
    <div>
      <p className="sr-only">
        Open and done task counts for {data.length} members:{" "}
        {data
          .map((row) => `${row.displayName} — ${row.openCount} open, ${row.doneCount} done`)
          .join("; ")}
        .
      </p>
      <ResponsiveContainer width="100%" height={Math.max(220, data.length * 40)}>
        <BarChart data={data} layout="vertical">
          <XAxis type="number" allowDecimals={false} />
          <YAxis type="category" dataKey="displayName" width={120} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="openCount" stackId="a" fill="var(--color-chart-2, #94a3b8)" name="Open" />
          <Bar dataKey="doneCount" stackId="a" fill="var(--color-chart-1, #6366f1)" name="Done" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

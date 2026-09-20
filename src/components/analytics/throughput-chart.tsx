"use client";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { InsufficientDataCard } from "./insufficient-data-card";

export type ThroughputRow = { weekStart: string; completedCount: number };

export function ThroughputChart({ data }: { data: ThroughputRow[] }) {
  if (data.length < 2) return <InsufficientDataCard minWeeks={2} />;
  const total = data.reduce((sum, row) => sum + row.completedCount, 0);
  return (
    <div>
      <p className="sr-only">
        {total} tasks completed across {data.length} weeks shown.
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <XAxis dataKey="weekStart" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="completedCount" fill="var(--color-chart-1, #6366f1)" radius={4} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

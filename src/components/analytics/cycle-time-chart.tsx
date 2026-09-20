"use client";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { InsufficientDataCard } from "./insufficient-data-card";

export type CycleTimeRow = {
  weekStart: string;
  sampleSize: number;
  medianHours: number | null;
  p25Hours: number | null;
  p75Hours: number | null;
};

export function CycleTimeChart({ data }: { data: CycleTimeRow[] }) {
  const withData = data.filter((row) => row.medianHours !== null);
  if (withData.length < 2) return <InsufficientDataCard minWeeks={2} />;
  return (
    <div>
      <p className="sr-only">
        Median cycle time across {withData.length} weeks with at least 3 completions each; weeks
        with fewer than 3 completions are omitted to avoid a misleading single-point median.
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={withData}>
          <XAxis dataKey="weekStart" tick={{ fontSize: 11 }} />
          <YAxis unit="h" />
          <Tooltip />
          <Line
            type="monotone"
            dataKey="medianHours"
            stroke="var(--color-chart-1, #6366f1)"
            strokeWidth={2}
            dot
          />
          <Line
            type="monotone"
            dataKey="p25Hours"
            stroke="var(--color-chart-2, #94a3b8)"
            strokeDasharray="4 4"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="p75Hours"
            stroke="var(--color-chart-2, #94a3b8)"
            strokeDasharray="4 4"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

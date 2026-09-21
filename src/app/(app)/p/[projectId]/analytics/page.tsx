import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChartErrorBoundary } from "@/components/analytics/chart-error-boundary";
import { StatTile } from "@/components/analytics/stat-tile";
import { ThroughputChart } from "@/components/analytics/throughput-chart";
import { CycleTimeChart } from "@/components/analytics/cycle-time-chart";
import { CumulativeFlowChart } from "@/components/analytics/cumulative-flow-chart";
import { WorkloadChart } from "@/components/analytics/workload-chart";

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const [throughput, cycleTime, flow, workload, summary] = await Promise.all([
    supabase.rpc("analytics_throughput", { p_project_id: projectId, p_weeks: 12 }),
    supabase.rpc("analytics_cycle_time", { p_project_id: projectId, p_weeks: 12 }),
    supabase.rpc("analytics_cumulative_flow", { p_project_id: projectId, p_days: 30 }),
    supabase.rpc("analytics_workload", { p_project_id: projectId }),
    supabase.rpc("analytics_summary", { p_project_id: projectId }),
  ]);

  // A non-member gets P0002 (project-scoped 404, matching every other
  // project-scoped read in this app) from every RPC above — surface it
  // instead of rendering a zeroed dashboard that looks like real data. Any
  // other error (timeout, migration drift) is a genuine failure, not "no
  // data," so it must not render as legitimate zeros either.
  const results = [throughput, cycleTime, flow, workload, summary];
  if (results.some((r) => r.error?.code === "P0002")) notFound();
  const firstError = results.find((r) => r.error)?.error;
  if (firstError) {
    throw new Error(`Analytics could not be loaded: ${firstError.message}`);
  }

  const summaryRow = Array.isArray(summary.data) ? summary.data[0] : summary.data;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <h1 className="text-xl font-semibold">Analytics</h1>
      <p className="text-muted-foreground text-xs">
        Cycle time evaluates each task&apos;s column against the board&apos;s current workflow, not
        the workflow that was in place on that historical date.
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Open" value={String(summaryRow?.total_open ?? 0)} />
        <StatTile label="Done" value={String(summaryRow?.total_done ?? 0)} />
        <StatTile label="Overdue" value={String(summaryRow?.overdue_count ?? 0)} />
        <StatTile
          label="Avg cycle time"
          value={summaryRow?.avg_cycle_hours ? `${Math.round(summaryRow.avg_cycle_hours)}h` : "—"}
        />
      </div>
      <ChartErrorBoundary label="Throughput">
        <ThroughputChart
          data={(throughput.data ?? []).map(
            (r: { week_start: string; completed_count: number }) => ({
              weekStart: r.week_start,
              completedCount: r.completed_count,
            }),
          )}
        />
      </ChartErrorBoundary>
      <ChartErrorBoundary label="Cycle time">
        <CycleTimeChart
          data={(cycleTime.data ?? []).map(
            (r: {
              week_start: string;
              sample_size: number;
              median_hours: number | null;
              p25_hours: number | null;
              p75_hours: number | null;
            }) => ({
              weekStart: r.week_start,
              sampleSize: r.sample_size,
              medianHours: r.median_hours,
              p25Hours: r.p25_hours,
              p75Hours: r.p75_hours,
            }),
          )}
        />
      </ChartErrorBoundary>
      <ChartErrorBoundary label="Cumulative flow">
        <CumulativeFlowChart
          data={(flow.data ?? []).map(
            (r: {
              snapshot_date: string;
              column_id: string;
              column_name: string;
              task_count: number;
            }) => ({
              snapshotDate: r.snapshot_date,
              columnId: r.column_id,
              columnName: r.column_name,
              taskCount: r.task_count,
            }),
          )}
        />
      </ChartErrorBoundary>
      <ChartErrorBoundary label="Workload">
        <WorkloadChart
          data={(workload.data ?? []).map(
            (r: {
              member_user_id: string;
              display_name: string;
              open_count: number;
              done_count: number;
            }) => ({
              memberUserId: r.member_user_id,
              displayName: r.display_name,
              openCount: r.open_count,
              doneCount: r.done_count,
            }),
          )}
        />
      </ChartErrorBoundary>
    </div>
  );
}

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChartErrorBoundary } from "@/components/analytics/chart-error-boundary";
import { StatTile } from "@/components/analytics/stat-tile";
import { ThroughputChart } from "@/components/analytics/throughput-chart";
import { CycleTimeChart } from "@/components/analytics/cycle-time-chart";
import { CumulativeFlowChart } from "@/components/analytics/cumulative-flow-chart";
import { ProgressOverview } from "@/components/analytics/progress-overview";
import { MemberProgressTable } from "@/components/analytics/member-progress-table";
import { AtRiskList } from "@/components/analytics/at-risk-list";
import { BreakdownChart, type BreakdownRow } from "@/components/analytics/breakdown-chart";

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  // Analytics is owner/admin only. The RPCs enforce this too (P0002 for
  // anyone else); checking first avoids eight doomed round-trips.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership?.role !== "owner" && membership?.role !== "admin") notFound();

  const [throughput, cycleTime, flow, summary, columns, members, atRisk, breakdown] =
    await Promise.all([
      supabase.rpc("analytics_throughput", { p_project_id: projectId, p_weeks: 12 }),
      supabase.rpc("analytics_cycle_time", { p_project_id: projectId, p_weeks: 12 }),
      supabase.rpc("analytics_cumulative_flow", { p_project_id: projectId, p_days: 30 }),
      supabase.rpc("analytics_summary", { p_project_id: projectId }),
      supabase.rpc("analytics_column_breakdown", { p_project_id: projectId }),
      supabase.rpc("analytics_member_progress", { p_project_id: projectId, p_days: 30 }),
      supabase.rpc("analytics_at_risk", { p_project_id: projectId, p_limit: 50 }),
      supabase.rpc("analytics_breakdown", { p_project_id: projectId }),
    ]);

  // P0002 (not an admin, or no such project) is a 404, matching every other
  // project-scoped read in this app. Any other error (timeout, migration
  // drift) is a genuine failure, not "no data," so it must not render as
  // legitimate zeros either.
  const results = [throughput, cycleTime, flow, summary, columns, members, atRisk, breakdown];
  if (results.some((r) => r.error?.code === "P0002")) notFound();
  const firstError = results.find((r) => r.error)?.error;
  if (firstError) {
    throw new Error(`Analytics could not be loaded: ${firstError.message}`);
  }

  const summaryRow = Array.isArray(summary.data) ? summary.data[0] : summary.data;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <h1 className="text-headline-lg-mobile sm:text-headline-lg font-serif font-medium">
        Analytics
      </h1>
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
      <ChartErrorBoundary label="Overall progress">
        <ProgressOverview
          rows={(columns.data ?? []).map(
            (r: {
              column_id: string;
              column_name: string;
              is_done_column: boolean;
              task_count: number;
            }) => ({
              columnId: r.column_id,
              name: r.column_name,
              isDone: r.is_done_column,
              taskCount: r.task_count,
            }),
          )}
        />
      </ChartErrorBoundary>
      <ChartErrorBoundary label="Overdue and at risk">
        <AtRiskList
          projectId={projectId}
          tasks={(atRisk.data ?? []).map(
            (r: {
              task_id: string;
              title: string;
              due_date: string;
              priority: string;
              column_name: string;
              assignee_name: string | null;
              is_overdue: boolean;
              days_until_due: number;
            }) => ({
              taskId: r.task_id,
              title: r.title,
              dueDate: r.due_date,
              priority: r.priority,
              columnName: r.column_name,
              assigneeName: r.assignee_name,
              isOverdue: r.is_overdue,
              daysUntilDue: r.days_until_due,
            }),
          )}
        />
      </ChartErrorBoundary>
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
      <ChartErrorBoundary label="Progress by member">
        <MemberProgressTable
          rows={(members.data ?? []).map(
            (r: {
              member_user_id: string | null;
              display_name: string;
              member_role: string | null;
              open_count: number;
              in_progress_count: number;
              completed_in_period: number;
              overdue_count: number;
              due_soon_count: number;
            }) => ({
              memberUserId: r.member_user_id,
              displayName: r.display_name,
              role: r.member_role,
              openCount: r.open_count,
              inProgressCount: r.in_progress_count,
              completedInPeriod: r.completed_in_period,
              overdueCount: r.overdue_count,
              dueSoonCount: r.due_soon_count,
            }),
          )}
        />
      </ChartErrorBoundary>
      <ChartErrorBoundary label="By priority and label">
        <BreakdownChart
          rows={(breakdown.data ?? []).map(
            (r: {
              dimension: BreakdownRow["dimension"];
              key: string;
              name: string;
              color: string | null;
              open_count: number;
              done_count: number;
            }) => ({
              dimension: r.dimension,
              key: r.key,
              name: r.name,
              color: r.color,
              openCount: r.open_count,
              doneCount: r.done_count,
            }),
          )}
        />
      </ChartErrorBoundary>
    </div>
  );
}

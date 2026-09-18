import { createAdminClient } from "@/lib/supabase/admin";

export type ClaimResult = { claimed: boolean };

/**
 * Idempotency gate on public.job_runs (job_name, run_key). Insert-or-nothing:
 * the first caller for a given key gets claimed: true and owns finishing the
 * run; every later caller for the same key (a retried HTTP delivery, an
 * overlapping cron tick) gets claimed: false and must no-op.
 */
export async function claimJobRun(jobName: string, runKey: string): Promise<ClaimResult> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("job_runs")
    .insert({ job_name: jobName, run_key: runKey })
    .select("job_name")
    .single();
  if (error) {
    // 23505 = unique_violation on (job_name, run_key) — already claimed.
    if (error.code === "23505") return { claimed: false };
    throw error;
  }
  return { claimed: true };
}

export async function finishJobRun(jobName: string, runKey: string, error?: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("job_runs")
    .update({ finished_at: new Date().toISOString(), error: error ?? null })
    .eq("job_name", jobName)
    .eq("run_key", runKey);
}

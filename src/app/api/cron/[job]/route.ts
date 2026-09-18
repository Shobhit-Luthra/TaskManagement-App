import { NextResponse, type NextRequest } from "next/server";
import { verifyCronSecret } from "@/lib/cron/verify-secret";
import { claimJobRun, finishJobRun } from "@/lib/cron/job-runs";
import { flushNotificationQueue } from "@/lib/notifications/flush";
import { log } from "@/lib/log";

const JOBS: Record<string, () => Promise<unknown>> = {
  "notification-flush": flushNotificationQueue,
};

export async function POST(request: NextRequest, context: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET ?? "";
  const authHeader = request.headers.get("authorization");
  const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!secret || !verifyCronSecret(provided, secret)) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Invalid cron secret." } },
      { status: 401 },
    );
  }

  const { job } = await context.params;
  const runner = JOBS[job];
  if (!runner) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Unknown job." } },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { run_key?: unknown };
  const runKey =
    typeof body.run_key === "string" && body.run_key.length > 0
      ? body.run_key
      : new Date().toISOString();

  const claim = await claimJobRun(job, runKey);
  if (!claim.claimed) {
    return NextResponse.json({ ok: true, skipped: "already run" });
  }

  try {
    const result = await runner();
    await finishJobRun(job, runKey);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishJobRun(job, runKey, message);
    log("error", "cron.job_failed", { job, runKey });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Job failed." } },
      { status: 500 },
    );
  }
}

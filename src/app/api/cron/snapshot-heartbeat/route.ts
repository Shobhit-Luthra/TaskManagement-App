import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { verifyCronSecret } from "@/lib/cron/verify-secret";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET ?? "";
  const authHeader = request.headers.get("authorization");
  const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!secret || !verifyCronSecret(provided, secret)) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Invalid cron secret." } },
      { status: 401 },
    );
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin
    .from("job_runs")
    .select("finished_at, error")
    .eq("job_name", "board_snapshot")
    .eq("run_key", today)
    .maybeSingle();

  const healthy = Boolean(data && data.finished_at && !data.error);
  if (!healthy) {
    log("error", "cron.snapshot_missing", { runKey: today });
    Sentry.captureMessage("board_snapshot job missed or errored", {
      level: "error",
      tags: { runKey: today },
    });
  }
  return NextResponse.json({ ok: healthy }, { status: 200 });
}

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !constantTimeEquals(auth, `Bearer ${secret}`)) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Unauthorized." } },
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

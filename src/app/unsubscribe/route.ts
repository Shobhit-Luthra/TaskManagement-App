import { NextResponse } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { createAdminClient } from "@/lib/supabase/admin";

const GENERIC_INVALID_HTML =
  "<!doctype html><html><body><p>This link is no longer valid.</p></body></html>";
const SUCCESS_HTML =
  "<!doctype html><html><body><p>You've been unsubscribed. You can change this any time in Kanbo's Account Settings.</p></body></html>";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  const verified = token ? verifyUnsubscribeToken(token) : null;
  if (!verified) {
    return new NextResponse(GENERIC_INVALID_HTML, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }

  const admin = createAdminClient();
  // A verified-but-stale token (e.g. the account was deleted since the email
  // went out) gets the same success copy as a real unsubscribe — revealing
  // "no such user" here would enumerate accounts.
  await admin
    .from("notification_preferences")
    .upsert(
      { user_id: verified.userId, category: verified.category, email: false },
      { onConflict: "user_id,category" },
    );

  return new NextResponse(SUCCESS_HTML, { status: 200, headers: { "content-type": "text/html" } });
}

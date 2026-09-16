import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const url = request.nextUrl.clone();
  if (!tokenHash || (type !== "signup" && type !== "recovery" && type !== "email_change")) {
    url.pathname = "/login";
    url.search = "?error=confirm";
    return NextResponse.redirect(url);
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  const inviteToken = request.cookies.get("kanbo_invite")?.value;
  url.pathname = error
    ? "/login"
    : type === "recovery"
      ? "/reset-password"
      : inviteToken
        ? `/invite/${inviteToken}`
        : "/projects";
  url.search = error ? "?error=confirm" : "";
  const response = NextResponse.redirect(url);
  if (inviteToken) response.cookies.delete("kanbo_invite");
  return response;
}

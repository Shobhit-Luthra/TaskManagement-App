import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/projects";
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const url = request.nextUrl.clone();
  if (!code) {
    url.pathname = "/login";
    url.search = "?error=oauth";
    return NextResponse.redirect(url);
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  const inviteToken = request.cookies.get("kanbo_invite")?.value;
  url.pathname = error
    ? "/login"
    : inviteToken
      ? `/invite/${inviteToken}`
      : safeNext(request.nextUrl.searchParams.get("next"));
  url.search = error ? "?error=oauth" : "";
  const response = NextResponse.redirect(url);
  if (inviteToken) response.cookies.delete("kanbo_invite");
  return response;
}

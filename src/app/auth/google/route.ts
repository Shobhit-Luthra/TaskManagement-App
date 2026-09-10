import { NextResponse } from "next/server";
import { clientEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${clientEnv.NEXT_PUBLIC_SITE_URL}/auth/callback` },
  });
  if (error || !data.url)
    return NextResponse.redirect(new URL("/login?oauth=failed", clientEnv.NEXT_PUBLIC_SITE_URL));
  return NextResponse.redirect(data.url);
}

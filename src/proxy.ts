import type { NextRequest } from "next/server";
import { clientEnv } from "@/lib/env";
import { buildCsp, generateNonce } from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp({
    nonce,
    supabaseUrl: clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    sentryDsn: clientEnv.NEXT_PUBLIC_SENTRY_DSN,
    isDev: process.env.NODE_ENV === "development",
  });

  // Next reads the nonce off the forwarded request's CSP header and stamps it
  // onto every script tag it renders; x-nonce is for our own server components.
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", csp);

  const response = await updateSession(request);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export function securityHeaders(supabaseUrl: string) {
  const origin = new URL(supabaseUrl).origin;
  const websocketOrigin = origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  // Next's development runtime uses inline bootstrap code and eval-based source maps.
  // Blocking these prevents React from hydrating, leaving client UI frozen on its
  // server-rendered loading state. Production keeps eval disabled.
  const scriptSource =
    process.env.NODE_ENV === "development"
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    `connect-src 'self' ${origin} ${websocketOrigin}`,
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline'",
    scriptSource,
  ].join("; ");
  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
  ];
}

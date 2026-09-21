export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function buildCsp(params: {
  nonce: string;
  supabaseUrl: string;
  sentryDsn?: string;
  isDev: boolean;
}): string {
  const origin = new URL(params.supabaseUrl).origin;
  const websocketOrigin = origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const sentryOrigin = params.sentryDsn ? ` ${new URL(params.sentryDsn).origin}` : "";
  // Dev needs eval for React Refresh / source maps; production keeps it off.
  const scriptSource = params.isDev
    ? `script-src 'self' 'nonce-${params.nonce}' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${params.nonce}'`;

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    `connect-src 'self' ${origin} ${websocketOrigin}${sentryOrigin}`,
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline'",
    scriptSource,
  ].join("; ");
}

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export const REDACTED_KEYS = [
  "token",
  "password",
  "secret",
  "authorization",
  "cookie",
  "email",
  "body",
] as const;

function redact(fields: LogFields): LogFields {
  const result: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] = REDACTED_KEYS.some((sensitive) => key.toLowerCase().includes(sensitive))
      ? "[redacted]"
      : value;
  }
  return result;
}

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...redact(fields),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

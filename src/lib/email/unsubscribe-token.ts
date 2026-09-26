import { createHmac, timingSafeEqual } from "node:crypto";

export type NotificationCategory =
  "assignment" | "mention" | "status_change" | "due_soon" | "digest" | "membership";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.UNSUBSCRIBE_SECRET;
  if (!value) throw new Error("UNSUBSCRIBE_SECRET is not set");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const aDigest = createHmac("sha256", "compare").update(a).digest();
  const bDigest = createHmac("sha256", "compare").update(b).digest();
  return timingSafeEqual(aDigest, bDigest);
}

/** Single-purpose, expiring token: encodes exactly one (userId, category)
 * pair (G12). Verifying it can only ever flip that one category off. */
export function generateUnsubscribeToken(userId: string, category: NotificationCategory): string {
  const payload = Buffer.from(JSON.stringify({ userId, category, issuedAt: Date.now() })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

export function verifyUnsubscribeToken(
  token: string,
): { userId: string; category: NotificationCategory } | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;
  if (!constantTimeEqual(sign(payload), signature)) return null;

  let decoded: { userId?: unknown; category?: unknown; issuedAt?: unknown };
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
  if (
    typeof decoded.userId !== "string" ||
    typeof decoded.category !== "string" ||
    typeof decoded.issuedAt !== "number"
  ) {
    return null;
  }
  if (Date.now() - decoded.issuedAt > THIRTY_DAYS_MS) return null;

  return { userId: decoded.userId, category: decoded.category as NotificationCategory };
}

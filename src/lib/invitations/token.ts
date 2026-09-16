import { randomBytes, createHash } from "node:crypto";

/** 32 CSPRNG bytes, base64url-encoded (no padding) — the value mailed to
 * the invitee. Only its SHA-256 hex digest is ever stored, so a database
 * read can never recover a usable token (05 §2). */
export function generateInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

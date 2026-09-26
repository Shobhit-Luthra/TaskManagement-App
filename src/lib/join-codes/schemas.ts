import { z } from "zod";

export const INVALID_CODE_MESSAGE = "That code isn't valid or has expired.";

export const JOIN_CODE_PATTERN = /^\d{6}$/;

export const requestToJoinSchema = z.object({
  code: z.string().trim().regex(JOIN_CODE_PATTERN, "Enter the 6-digit code"),
});

// Owner is never grantable; the RPC additionally rejects roles at or above
// the approver's own (an admin cannot approve someone as admin).
export const joinRoleSchema = z.enum(["admin", "member", "viewer"]);
export type JoinRole = z.infer<typeof joinRoleSchema>;

export const decideJoinRequestSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), role: joinRoleSchema }),
  z.object({ decision: z.literal("deny") }),
]);
export type DecideJoinRequestInput = z.infer<typeof decideJoinRequestSchema>;

export type JoinCode = { code: string; expires_at: string; disabled_at: string | null };

export type PendingJoinRequest = {
  id: string;
  user_id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  created_at: string;
};

export type MyJoinRequest = {
  id: string;
  project_id: string;
  project_name: string;
  created_at: string;
};

/** Roles the viewer may grant: strictly below their own, never owner. */
export function grantableRoles(viewerRole: string): JoinRole[] {
  if (viewerRole === "owner") return ["admin", "member", "viewer"];
  if (viewerRole === "admin") return ["member", "viewer"];
  return [];
}

/** Strips everything but digits and keeps at most six (for paste handling). */
export function normalizeJoinCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, 6);
}

/** A code is usable when it exists, is not turned off and has not expired. */
export function isJoinCodeActive(code: JoinCode | null, now: Date = new Date()): boolean {
  return !!code && code.disabled_at === null && new Date(code.expires_at) > now;
}

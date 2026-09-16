import { z } from "zod";

export const invitationRoleSchema = z.enum(["admin", "member", "viewer"]); // owner excluded — never invitable
export const createInvitationSchema = z.object({
  email: z.string().trim().email().max(254),
  role: invitationRoleSchema,
});
export const invitationSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  email: z.string(),
  role: z.enum(["owner", "admin", "member", "viewer"]),
  expiresAt: z.string(),
  createdAt: z.string(),
  resent: z.boolean(),
});

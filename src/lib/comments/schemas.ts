import { z } from "zod";

export const commentBodySchema = z.string().trim().min(1).max(5000);
export const mentionIdsSchema = z.array(z.string().uuid()).max(50).default([]);

export const createCommentSchema = z.object({
  body: commentBodySchema,
  mentionedUserIds: mentionIdsSchema,
});

export const updateCommentSchema = z.object({
  body: commentBodySchema,
  mentionedUserIds: mentionIdsSchema,
  expectedUpdatedAt: z.string().datetime({ offset: true }),
});

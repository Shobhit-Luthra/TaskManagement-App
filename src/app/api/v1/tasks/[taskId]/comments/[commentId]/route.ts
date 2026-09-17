import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { parseMentions } from "@/lib/comments/mentions";
import { updateCommentSchema } from "@/lib/comments/schemas";

const paramsSchema = z.object({ taskId: z.string().uuid(), commentId: z.string().uuid() });

export const PATCH = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: paramsSchema,
    body: updateCommentSchema,
    notFoundMessage: "Comment not found.",
    unauthenticatedMessage: "Sign in to edit comments.",
    validationMessage: "Check the comment and try again.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("update_comment", {
      p_comment_id: params.commentId,
      p_body: body.body,
      p_mentioned_user_ids: parseMentions(body.body),
      p_expected_updated_at: body.expectedUpdatedAt,
    });
    if (error)
      return mapRpcError(error, {
        message: "Comment could not be updated.",
        requestId,
        projectScoped: true,
      });
    return json({ data: Array.isArray(data) ? data[0] : data });
  },
);

export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: paramsSchema,
    notFoundMessage: "Comment not found.",
    unauthenticatedMessage: "Sign in to delete comments.",
  },
  async ({ supabase, params, requestId }) => {
    const { error } = await supabase.rpc("soft_delete_comment", { p_comment_id: params.commentId });
    if (error)
      return mapRpcError(error, {
        message: "Comment could not be deleted.",
        requestId,
        projectScoped: true,
      });
    return new Response(null, { status: 204 });
  },
);

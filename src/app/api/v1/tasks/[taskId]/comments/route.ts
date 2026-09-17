import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { parseMentions } from "@/lib/comments/mentions";
import { createCommentSchema } from "@/lib/comments/schemas";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.reads,
    params: z.object({ taskId: z.string().uuid() }),
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to view comments.",
  },
  async ({ supabase, params }) => {
    const { data, error } = await supabase
      .from("comments")
      .select("id, task_id, author_id, body, mentioned_user_ids, created_at, updated_at")
      .eq("task_id", params.taskId)
      .order("created_at", { ascending: true });
    if (error) return apiError(404, "NOT_FOUND", "Task not found.");
    return json({ data: data ?? [] });
  },
);

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid() }),
    body: createCommentSchema,
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to comment.",
    validationMessage: "Check the comment and try again.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("create_comment", {
      p_task_id: params.taskId,
      p_body: body.body,
      p_mentioned_user_ids: parseMentions(body.body),
    });
    if (error) {
      return mapRpcError(error, {
        message: "Comment could not be posted.",
        requestId,
        projectScoped: true,
      });
    }
    const comment = firstRow(data);
    if (!comment)
      return apiError(500, "INTERNAL_ERROR", "Comment creation returned no comment.", {
        requestId,
      });
    return json({ data: comment }, { status: 201 });
  },
);

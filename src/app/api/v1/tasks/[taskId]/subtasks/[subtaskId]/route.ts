import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { updateSubtaskSchema } from "@/lib/tasks/schemas";

export const PATCH = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid(), subtaskId: z.string().uuid() }),
    body: updateSubtaskSchema,
    notFoundMessage: "Subtask not found.",
    unauthenticatedMessage: "Sign in to update subtasks.",
    validationMessage: "Check the subtask and try again.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("update_subtask", {
      p_task_id: params.taskId,
      p_subtask_id: params.subtaskId,
      p_title: body.title ?? null,
      p_is_completed: body.isCompleted ?? null,
    });
    if (error)
      return mapRpcError(error, {
        message: "Subtask could not be updated.",
        requestId,
        projectScoped: true,
      });
    return json({ data: Array.isArray(data) ? data[0] : data });
  },
);

export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid(), subtaskId: z.string().uuid() }),
    notFoundMessage: "Subtask not found.",
    unauthenticatedMessage: "Sign in to delete subtasks.",
  },
  async ({ supabase, params, requestId }) => {
    const { error } = await supabase.rpc("delete_subtask", {
      p_task_id: params.taskId,
      p_subtask_id: params.subtaskId,
    });
    if (error)
      return mapRpcError(error, {
        message: "Subtask could not be deleted.",
        requestId,
        projectScoped: true,
      });
    return new Response(null, { status: 204 });
  },
);

import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { updateTaskSchema } from "@/lib/tasks/schemas";

export const PATCH = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid() }),
    body: updateTaskSchema,
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to update tasks.",
    validationMessage: "Check the task details and try again.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("update_task", {
      p_task_id: params.taskId,
      p_title: body.title,
      p_description: body.description,
      p_due_date: body.dueDate,
      p_priority: body.priority,
    });
    if (error) return mapRpcError(error, { message: "Task could not be updated.", requestId });
    const task = firstRow(data);
    if (!task)
      return apiError(500, "INTERNAL_ERROR", "Task update returned no task.", { requestId });
    return json({ data: task });
  },
);

export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid() }),
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to delete tasks.",
  },
  async ({ supabase, params, requestId }) => {
    const { error } = await supabase.rpc("soft_delete_task", { p_task_id: params.taskId });
    if (error) return mapRpcError(error, { message: "Task could not be deleted.", requestId });
    return new Response(null, { status: 204 });
  },
);

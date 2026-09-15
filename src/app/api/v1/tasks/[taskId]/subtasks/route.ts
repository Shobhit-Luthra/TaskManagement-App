import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { createSubtaskSchema } from "@/lib/tasks/schemas";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.reads,
    params: z.object({ taskId: z.string().uuid() }),
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to view subtasks.",
  },
  async ({ supabase, params }) => {
    const { data, error } = await supabase
      .from("subtasks")
      .select("id, task_id, title, is_completed, position, created_at, updated_at")
      .eq("task_id", params.taskId)
      .order("position");
    if (error) return apiError(404, "NOT_FOUND", "Task not found.");
    return json({ data: data ?? [] });
  },
);

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid() }),
    body: createSubtaskSchema,
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to add subtasks.",
    validationMessage: "Check the subtask and try again.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("create_subtask", {
      p_task_id: params.taskId,
      p_title: body.title,
    });
    if (error)
      return mapRpcError(error, {
        message: "Subtask could not be created.",
        requestId,
        projectScoped: true,
      });
    const subtask = firstRow(data);
    if (!subtask)
      return apiError(500, "INTERNAL_ERROR", "Subtask creation returned no subtask.", {
        requestId,
      });
    return json({ data: subtask }, { status: 201 });
  },
);

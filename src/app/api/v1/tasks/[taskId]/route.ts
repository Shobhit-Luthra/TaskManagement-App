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
      p_assignee_id: body.assigneeId ?? null,
      p_expected_updated_at: body.expectedUpdatedAt ?? null,
    });
    if (error?.code === "P0004") {
      const { data: current } = await supabase
        .from("tasks")
        .select(
          "id, column_id, title, description, due_date, priority, position, assignee_id, created_at, updated_at",
        )
        .eq("id", params.taskId)
        .maybeSingle();
      return apiError(409, "CONFLICT", "This task changed since you opened it.", { current });
    }
    if (error)
      return mapRpcError(error, {
        message: "Task could not be updated.",
        requestId,
        projectScoped: true,
      });
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
    if (error)
      return mapRpcError(error, {
        message: "Task could not be deleted.",
        requestId,
        projectScoped: true,
      });
    return new Response(null, { status: 204 });
  },
);

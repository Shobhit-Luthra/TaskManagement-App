import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { moveTaskSchema } from "@/lib/tasks/schemas";

export const PATCH = withApiHandler(
  {
    params: z.object({ taskId: z.string().uuid() }),
    body: moveTaskSchema,
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to move tasks.",
    validationMessage: "Check where this task should move.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("move_task", {
      p_task_id: params.taskId,
      p_column_id: body.columnId,
      p_position: body.position,
      p_mutation_id: body.mutationId,
    });
    if (error) return mapRpcError(error, { message: "Task could not be moved.", requestId });
    const task = firstRow(data);
    if (!task) return apiError(500, "INTERNAL_ERROR", "Task move returned no task.", { requestId });
    return json({ data: task });
  },
);

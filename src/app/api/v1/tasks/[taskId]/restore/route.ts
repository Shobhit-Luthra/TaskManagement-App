import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid() }),
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to restore tasks.",
  },
  async ({ supabase, params, requestId }) => {
    const { data, error } = await supabase.rpc("restore_task", { p_task_id: params.taskId });
    if (error) {
      return mapRpcError(error, {
        message: "Task could not be restored.",
        requestId,
        projectScoped: true,
      });
    }
    const task = firstRow(data);
    if (!task)
      return apiError(500, "INTERNAL_ERROR", "Task restore returned no task.", { requestId });
    return json({ data: task });
  },
);

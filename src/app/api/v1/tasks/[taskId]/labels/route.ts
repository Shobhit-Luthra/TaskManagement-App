import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { setTaskLabelsSchema } from "@/lib/labels/schemas";

export const PUT = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid() }),
    body: setTaskLabelsSchema,
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to change labels.",
    validationMessage: "Check the labels and try again.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("set_task_labels", {
      p_task_id: params.taskId,
      p_label_ids: body.labelIds,
    });
    if (error)
      return mapRpcError(error, {
        message: "Labels could not be updated.",
        requestId,
        projectScoped: true,
      });
    return json({ data: Array.isArray(data) ? data[0] : data });
  },
);

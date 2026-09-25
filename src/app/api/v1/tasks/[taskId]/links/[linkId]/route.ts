import { z } from "zod";
import { mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid(), linkId: z.string().uuid() }),
    notFoundMessage: "Link not found.",
    unauthenticatedMessage: "Sign in to remove links.",
  },
  async ({ supabase, params, requestId }) => {
    const { error } = await supabase.rpc("delete_task_link", {
      p_task_id: params.taskId,
      p_link_id: params.linkId,
    });
    if (error) return mapRpcError(error, { message: "Link could not be removed.", requestId });
    return new Response(null, { status: 204 });
  },
);

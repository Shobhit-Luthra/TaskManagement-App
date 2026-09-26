import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.reads,
    params: z.object({ projectId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
  },
  async ({ supabase, params, requestId }) => {
    const { data, error } = await supabase.rpc("list_join_requests", {
      p_project_id: params.projectId,
    });
    if (error)
      return mapRpcError(error, {
        message: "Project not found.",
        requestId,
        projectScoped: true,
      });
    return json({ data: data ?? [] });
  },
);

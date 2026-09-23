import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const GET = withApiHandler(
  {
    params: z.object({ projectId: z.string().uuid() }),
    rateLimit: RATE_LIMITS.reads,
    notFoundMessage: "Project not found.",
  },
  async ({ supabase, params, requestId }) => {
    const { data, error } = await supabase.rpc("project_timeline", {
      p_project_id: params.projectId,
    });
    if (error)
      return mapRpcError(error, {
        message: "Timeline could not be loaded.",
        requestId,
        projectScoped: true,
      });
    return json({ data: data ?? [] });
  },
);

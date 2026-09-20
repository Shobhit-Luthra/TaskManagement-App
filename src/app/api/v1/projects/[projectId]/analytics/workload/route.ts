import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.analytics,
    params: z.object({ projectId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to view analytics.",
  },
  async ({ supabase, params, requestId }) => {
    const { data, error } = await supabase.rpc("analytics_workload", {
      p_project_id: params.projectId,
    });
    if (error)
      return mapRpcError(error, {
        message: "Workload could not be loaded.",
        requestId,
        projectScoped: true,
      });
    return json(
      { data, sampleSize: Array.isArray(data) ? data.length : 0 },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  },
);

import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { daysQuerySchema } from "@/lib/analytics/schemas";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.analytics,
    params: z.object({ projectId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to view analytics.",
  },
  async ({ supabase, params, request, requestId }) => {
    const query = daysQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    const days = query.success ? query.data.days : 30;
    const { data, error } = await supabase.rpc("analytics_member_progress", {
      p_project_id: params.projectId,
      p_days: days,
    });
    if (error)
      return mapRpcError(error, {
        message: "Member progress could not be loaded.",
        requestId,
        projectScoped: true,
      });
    return json(
      { data, sampleSize: Array.isArray(data) ? data.length : 0 },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  },
);

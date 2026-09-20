import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { weeksQuerySchema } from "@/lib/analytics/schemas";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.analytics,
    params: z.object({ projectId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to view analytics.",
  },
  async ({ supabase, params, request, requestId }) => {
    const query = weeksQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    const weeks = query.success ? query.data.weeks : 12;
    const { data, error } = await supabase.rpc("analytics_cycle_time", {
      p_project_id: params.projectId,
      p_weeks: weeks,
    });
    if (error)
      return mapRpcError(error, {
        message: "Cycle time could not be loaded.",
        requestId,
        projectScoped: true,
      });
    const rows = (data ?? []) as { sample_size: number }[];
    const sampleSize = rows.reduce((sum, row) => sum + row.sample_size, 0);
    return json({ data, sampleSize }, { headers: { "Cache-Control": "private, max-age=300" } });
  },
);

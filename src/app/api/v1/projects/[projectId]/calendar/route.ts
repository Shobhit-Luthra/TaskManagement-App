import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { loadCalendar } from "@/lib/calendar/load";

export const GET = withApiHandler(
  {
    params: z.object({ projectId: z.string().uuid() }),
    rateLimit: RATE_LIMITS.reads,
    notFoundMessage: "Project not found.",
  },
  async ({ supabase, request, params, requestId }) =>
    loadCalendar({ supabase, request, requestId, projectId: params.projectId }),
);

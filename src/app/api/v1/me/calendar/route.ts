import { withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { loadCalendar } from "@/lib/calendar/load";

export const GET = withApiHandler(
  { rateLimit: RATE_LIMITS.reads, unauthenticatedMessage: "Sign in to see your calendar." },
  async ({ supabase, request, requestId }) =>
    loadCalendar({ supabase, request, requestId, projectId: null }),
);

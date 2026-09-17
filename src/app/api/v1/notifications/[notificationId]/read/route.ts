import { z } from "zod";
import { mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ notificationId: z.string().uuid() }),
    unauthenticatedMessage: "Sign in to update notifications.",
    notFoundMessage: "Notification not found.",
  },
  async ({ supabase, params, requestId }) => {
    const { error } = await supabase.rpc("mark_notification_read", {
      p_notification_id: params.notificationId,
    });
    if (error)
      return mapRpcError(error, {
        message: "Notification could not be marked as read.",
        requestId,
      });
    return new Response(null, { status: 204 });
  },
);

import { mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const POST = withApiHandler(
  { rateLimit: RATE_LIMITS.writes, unauthenticatedMessage: "Sign in to update notifications." },
  async ({ supabase, requestId }) => {
    const { error } = await supabase.rpc("mark_all_notifications_read");
    if (error)
      return mapRpcError(error, {
        message: "Notifications could not be marked as read.",
        requestId,
      });
    return new Response(null, { status: 204 });
  },
);

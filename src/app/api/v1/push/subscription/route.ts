import { apiError } from "@/lib/api/response";
import { json, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@/lib/push/schemas";

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    body: pushSubscriptionSchema,
    unauthenticatedMessage: "Sign in to enable notifications.",
    validationMessage: "This browser's push service is not supported.",
  },
  async ({ user, body, request }) => {
    // Service role: the endpoint is validated above, and a device that changes hands (new
    // sign-in on the same browser) must move to the new user rather than collide.
    const { error } = await createAdminClient()
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          user_agent: request.headers.get("user-agent")?.slice(0, 255) ?? null,
        },
        { onConflict: "endpoint" },
      );
    if (error) return apiError(500, "INTERNAL_ERROR", "Notifications could not be enabled.");
    return json({ data: { subscribed: true } }, { status: 201 });
  },
);

export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    body: pushUnsubscribeSchema,
    unauthenticatedMessage: "Sign in to manage notifications.",
  },
  async ({ supabase, body }) => {
    // RLS limits the delete to the caller's own subscriptions.
    await supabase.from("push_subscriptions").delete().eq("endpoint", body.endpoint);
    return new Response(null, { status: 204 });
  },
);

import { z } from "zod";
import { json, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { apiError } from "@/lib/api/response";

const CATEGORIES = ["assignment", "mention", "status_change", "due_soon", "digest"] as const;

export const GET = withApiHandler(
  { rateLimit: RATE_LIMITS.reads, unauthenticatedMessage: "Sign in to view preferences." },
  async ({ supabase, user, requestId }) => {
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("category, email")
      .eq("user_id", user.id);
    if (error)
      return apiError(500, "INTERNAL_ERROR", "Preferences could not be loaded.", { requestId });
    const byCategory: Record<string, boolean> = Object.fromEntries(
      CATEGORIES.map((c) => [c, true]),
    );
    for (const row of (data ?? []) as { category: string; email: boolean }[]) {
      byCategory[row.category] = row.email;
    }
    return json({ data: byCategory });
  },
);

const updateSchema = z.object({ category: z.enum(CATEGORIES), email: z.boolean() });

export const PATCH = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    body: updateSchema,
    unauthenticatedMessage: "Sign in to update preferences.",
    validationMessage: "Provide category and email.",
  },
  async ({ supabase, user, body, requestId }) => {
    const { data, error } = await supabase
      .from("notification_preferences")
      .upsert(
        { user_id: user.id, category: body.category, email: body.email },
        { onConflict: "user_id,category" },
      )
      .select("category, email")
      .single();
    if (error)
      return apiError(500, "INTERNAL_ERROR", "Preference could not be updated.", { requestId });
    return json({ data });
  },
);

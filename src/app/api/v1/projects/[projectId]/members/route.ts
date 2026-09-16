import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { json, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.reads,
    params: z.object({ projectId: z.string().uuid() }),
    unauthenticatedMessage: "Sign in to view members.",
  },
  async ({ supabase, params, requestId }) => {
    const { data, error } = await supabase
      .from("memberships")
      .select("user_id, role, created_at, project_peers!inner(id, display_name, avatar_url)")
      .eq("project_id", params.projectId)
      .order("created_at", { ascending: true });
    if (error)
      return apiError(500, "INTERNAL_ERROR", "Members could not be loaded.", { requestId });
    return json({ data });
  },
);

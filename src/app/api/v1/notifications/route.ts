import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const GET = withApiHandler(
  { rateLimit: RATE_LIMITS.reads, unauthenticatedMessage: "Sign in to view notifications." },
  async ({ supabase, requestId }) => {
    const { data, error } = await supabase
      .from("notifications")
      .select("id, project_id, task_id, type, actor_id, payload, read_at, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(50);
    if (error)
      return mapRpcError(error, { message: "Notifications could not be loaded.", requestId });
    return json({ data: data ?? [] });
  },
);

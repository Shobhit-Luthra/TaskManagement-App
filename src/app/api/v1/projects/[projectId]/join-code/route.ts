import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

const params = z.object({ projectId: z.string().uuid() });
const NOT_FOUND = "Project not found.";

// RLS limits project_join_codes to owners/admins, so a member simply sees
// no row; both cases answer 404.
export const GET = withApiHandler(
  { rateLimit: RATE_LIMITS.reads, params, notFoundMessage: NOT_FOUND },
  async ({ supabase, params }) => {
    const { data: isAdmin } = await supabase.rpc("is_project_admin", {
      target_project: params.projectId,
    });
    if (!isAdmin) return apiError(404, "NOT_FOUND", NOT_FOUND);
    const { data, error } = await supabase
      .from("project_join_codes")
      .select("code, expires_at, disabled_at")
      .eq("project_id", params.projectId)
      .maybeSingle();
    if (error) return apiError(404, "NOT_FOUND", NOT_FOUND);
    return json({ data: data ?? null });
  },
);

export const POST = withApiHandler(
  { rateLimit: RATE_LIMITS.writes, params, notFoundMessage: NOT_FOUND },
  async ({ supabase, params, requestId }) => {
    const { data, error } = await supabase.rpc("generate_join_code", {
      p_project_id: params.projectId,
    });
    if (error)
      return mapRpcError(error, {
        message:
          error.code === "22023"
            ? "Archived boards can't have a join code."
            : "The join code could not be created.",
        requestId,
        projectScoped: true,
      });
    const row = firstRow(data as { code: string; expires_at: string }[] | null);
    if (!row) return apiError(500, "INTERNAL_ERROR", "No join code was returned.", { requestId });
    return json({ data: { ...row, disabled_at: null } }, { status: 201 });
  },
);

export const DELETE = withApiHandler(
  { rateLimit: RATE_LIMITS.writes, params, notFoundMessage: NOT_FOUND },
  async ({ supabase, params, requestId }) => {
    const { error } = await supabase.rpc("disable_join_code", { p_project_id: params.projectId });
    if (error)
      return mapRpcError(error, {
        message: "The join code could not be turned off.",
        requestId,
        projectScoped: true,
      });
    return new Response(null, { status: 204 });
  },
);

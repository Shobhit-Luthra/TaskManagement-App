import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

const paramsSchema = z.object({ projectId: z.string().uuid(), userId: z.string().uuid() });

export const PATCH = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: paramsSchema,
    body: z.object({ role: z.enum(["admin", "member", "viewer"]) }),
    notFoundMessage: "Member not found.",
    unauthenticatedMessage: "Sign in to change roles.",
    validationMessage: "Invalid role.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("change_member_role", {
      p_project_id: params.projectId,
      p_user_id: params.userId,
      p_role: body.role,
    });
    if (error)
      return mapRpcError(error, {
        message: "Role could not be changed.",
        requestId,
        projectScoped: true,
      });
    return json({ data: Array.isArray(data) ? data[0] : data });
  },
);

export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: paramsSchema,
    notFoundMessage: "Member not found.",
    unauthenticatedMessage: "Sign in to remove members.",
  },
  async ({ supabase, params, requestId }) => {
    const { error } = await supabase.rpc("remove_member", {
      p_project_id: params.projectId,
      p_user_id: params.userId,
    });
    if (error)
      return mapRpcError(error, {
        message: "Member could not be removed.",
        requestId,
        projectScoped: true,
      });
    return json({ data: { userId: params.userId } });
  },
);

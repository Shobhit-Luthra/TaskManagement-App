import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ projectId: z.string().uuid() }),
    body: z.object({ newOwnerId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to transfer ownership.",
    validationMessage: "Choose a member to transfer ownership to.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { error } = await supabase.rpc("transfer_ownership", {
      p_project_id: params.projectId,
      p_new_owner_id: body.newOwnerId,
    });
    if (error)
      return mapRpcError(error, {
        message: "Ownership could not be transferred.",
        requestId,
        projectScoped: true,
      });
    return json({ data: { projectId: params.projectId, newOwnerId: body.newOwnerId } });
  },
);

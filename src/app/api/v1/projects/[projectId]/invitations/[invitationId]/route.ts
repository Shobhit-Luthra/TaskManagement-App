import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ projectId: z.string().uuid(), invitationId: z.string().uuid() }),
    notFoundMessage: "Invitation not found.",
    unauthenticatedMessage: "Sign in to revoke invitations.",
  },
  async ({ supabase, params, requestId }) => {
    const { error } = await supabase.rpc("revoke_invitation", {
      p_invitation_id: params.invitationId,
    });
    if (error)
      return mapRpcError(error, {
        message: "Invitation could not be revoked.",
        requestId,
        projectScoped: true,
      });
    return json({ data: { id: params.invitationId } });
  },
);

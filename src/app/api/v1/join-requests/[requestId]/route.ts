import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { decideJoinRequestSchema } from "@/lib/join-codes/schemas";

const params = z.object({ requestId: z.string().uuid() });
const NOT_FOUND = "Join request not found.";

export const PATCH = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params,
    body: decideJoinRequestSchema,
    notFoundMessage: NOT_FOUND,
    validationMessage: "Choose a role to approve this request.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("decide_join_request", {
      p_request_id: params.requestId,
      p_approve: body.decision === "approve",
      p_role: body.decision === "approve" ? body.role : null,
    });
    if (error) {
      if (error.message?.includes("CANNOT_GRANT_ROLE")) {
        return apiError(403, "FORBIDDEN", "You can't grant a role equal to or above your own.");
      }
      return mapRpcError(error, {
        message:
          error.code === "P0003"
            ? "This request has already been handled."
            : error.code === "22023"
              ? "Choose a role to approve this request."
              : NOT_FOUND,
        requestId,
        projectScoped: true,
      });
    }
    const row = firstRow(data);
    if (!row) return apiError(500, "INTERNAL_ERROR", "No request was returned.", { requestId });
    return json({ data: row });
  },
);

export const DELETE = withApiHandler(
  { rateLimit: RATE_LIMITS.writes, params, notFoundMessage: NOT_FOUND },
  async ({ supabase, params, requestId }) => {
    const { error } = await supabase.rpc("cancel_join_request", { p_request_id: params.requestId });
    if (error) return mapRpcError(error, { message: NOT_FOUND, requestId });
    return new Response(null, { status: 204 });
  },
);

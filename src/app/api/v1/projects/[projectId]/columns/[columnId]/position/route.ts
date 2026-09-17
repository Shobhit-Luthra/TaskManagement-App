import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { moveColumnSchema } from "@/lib/columns/schemas";

export const PATCH = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ projectId: z.string().uuid(), columnId: z.string().uuid() }),
    body: moveColumnSchema,
    notFoundMessage: "Column not found.",
    unauthenticatedMessage: "Sign in to reorder columns.",
    validationMessage: "Check where this column should move.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("move_column", {
      p_column_id: params.columnId,
      p_position: body.position,
    });
    if (error) {
      return mapRpcError(error, {
        message: "Column could not be moved.",
        requestId,
        projectScoped: true,
      });
    }
    const column = firstRow(data);
    if (!column)
      return apiError(500, "INTERNAL_ERROR", "Column move returned no column.", { requestId });
    return json({ data: column });
  },
);

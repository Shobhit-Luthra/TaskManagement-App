import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { updateColumnSchema } from "@/lib/projects/schemas";

export const PATCH = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ projectId: z.string().uuid(), columnId: z.string().uuid() }),
    body: updateColumnSchema,
    notFoundMessage: "Column not found.",
    unauthenticatedMessage: "Sign in to manage columns.",
    validationMessage: "Check the column and try again.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("update_project_column", {
      p_project_id: params.projectId,
      p_column_id: params.columnId,
      p_name: body.name,
      p_wip_limit: body.wipLimit,
      p_is_done_column: body.isDoneColumn,
    });
    if (error) return mapRpcError(error, { message: "Column could not be updated.", requestId });
    return json({ data: Array.isArray(data) ? data[0] : data });
  },
);

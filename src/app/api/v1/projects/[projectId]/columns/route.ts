import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { createColumnSchema } from "@/lib/projects/schemas";

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ projectId: z.string().uuid() }),
    body: createColumnSchema,
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to manage columns.",
    validationMessage: "Check the column and try again.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("create_project_column", {
      p_project_id: params.projectId,
      p_name: body.name,
      p_wip_limit: body.wipLimit ?? null,
    });
    if (error)
      return mapRpcError(error, {
        message: "Column could not be created.",
        requestId,
        projectScoped: true,
      });
    return json({ data: Array.isArray(data) ? data[0] : data }, { status: 201 });
  },
);

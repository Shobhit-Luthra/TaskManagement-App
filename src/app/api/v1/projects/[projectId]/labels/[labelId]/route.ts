import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { updateLabelSchema } from "@/lib/labels/schemas";

const paramsSchema = z.object({ projectId: z.string().uuid(), labelId: z.string().uuid() });
export const PATCH = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: paramsSchema,
    body: updateLabelSchema,
    notFoundMessage: "Label not found.",
    unauthenticatedMessage: "Sign in to edit labels.",
    validationMessage: "Check the label and try again.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("update_label", {
      p_label_id: params.labelId,
      p_name: body.name,
      p_color: body.color,
    });
    if (error)
      return mapRpcError(error, {
        message: "Label could not be updated.",
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
    notFoundMessage: "Label not found.",
    unauthenticatedMessage: "Sign in to delete labels.",
  },
  async ({ supabase, params, requestId }) => {
    const { error } = await supabase.rpc("delete_label", { p_label_id: params.labelId });
    if (error)
      return mapRpcError(error, {
        message: "Label could not be deleted.",
        requestId,
        projectScoped: true,
      });
    return new Response(null, { status: 204 });
  },
);

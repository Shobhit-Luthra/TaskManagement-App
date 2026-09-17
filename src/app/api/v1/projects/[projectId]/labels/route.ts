import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { createLabelSchema } from "@/lib/labels/schemas";

const paramsSchema = z.object({ projectId: z.string().uuid() });

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.reads,
    params: paramsSchema,
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to view labels.",
  },
  async ({ supabase, params }) => {
    const { data, error } = await supabase
      .from("labels")
      .select("id, project_id, name, color, created_at")
      .eq("project_id", params.projectId)
      .order("name");
    if (error) return apiError(404, "NOT_FOUND", "Project not found.");
    return json({ data: data ?? [] });
  },
);

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: paramsSchema,
    body: createLabelSchema,
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to create labels.",
    validationMessage: "Check the label and try again.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("create_label", {
      p_project_id: params.projectId,
      p_name: body.name,
      p_color: body.color,
    });
    if (error)
      return mapRpcError(error, {
        message: "Label could not be created.",
        requestId,
        projectScoped: true,
      });
    const label = firstRow(data);
    return label
      ? json({ data: label }, { status: 201 })
      : apiError(500, "INTERNAL_ERROR", "Label creation returned no label.", { requestId });
  },
);

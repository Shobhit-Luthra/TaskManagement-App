import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

const patchSchema = z.union([
  z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).nullable(),
    timezone: z.string().trim().min(1).max(64),
  }),
  z.object({ isArchived: z.boolean() }),
]);

export const PATCH = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ projectId: z.string().uuid() }),
    body: patchSchema,
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to update projects.",
    validationMessage: "Check the project details and try again.",
  },
  async ({ supabase, params, body, requestId }) => {
    if ("isArchived" in body) {
      const { data, error } = await supabase.rpc("archive_project", {
        p_project_id: params.projectId,
        p_is_archived: body.isArchived,
      });
      if (error)
        return mapRpcError(error, {
          message: "Project could not be archived.",
          requestId,
          projectScoped: true,
        });
      return json({ data: Array.isArray(data) ? data[0] : data });
    }
    const { data, error } = await supabase.rpc("update_project", {
      p_project_id: params.projectId,
      p_name: body.name,
      p_description: body.description,
      p_timezone: body.timezone,
    });
    if (error)
      return mapRpcError(error, {
        message: "Project could not be updated.",
        requestId,
        projectScoped: true,
      });
    return json({ data: Array.isArray(data) ? data[0] : data });
  },
);

export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ projectId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to delete projects.",
  },
  async ({ supabase, params, requestId }) => {
    const { error } = await supabase.rpc("soft_delete_project", {
      p_project_id: params.projectId,
    });
    if (error)
      return mapRpcError(error, {
        message: "Project could not be deleted.",
        requestId,
        projectScoped: true,
      });
    return new Response(null, { status: 204 });
  },
);

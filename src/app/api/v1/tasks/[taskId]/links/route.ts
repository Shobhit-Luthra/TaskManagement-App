import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { createTaskLinkSchema } from "@/lib/links/schemas";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.reads,
    params: z.object({ taskId: z.string().uuid() }),
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to view links.",
  },
  async ({ supabase, params }) => {
    const { data, error } = await supabase
      .from("task_links")
      .select("id, task_id, url, title, created_by, created_at")
      .eq("task_id", params.taskId)
      .order("created_at");
    if (error) return apiError(404, "NOT_FOUND", "Task not found.");
    return json({ data: data ?? [] });
  },
);

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid() }),
    body: createTaskLinkSchema,
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to add links.",
    validationMessage: "Use a full link starting with http:// or https://.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("add_task_link", {
      p_task_id: params.taskId,
      p_url: body.url,
      p_title: body.title ?? null,
    });
    if (error)
      return mapRpcError(error, {
        message:
          error.code === "22023"
            ? "That link could not be added. Check it, or remove an old link if this task has 50."
            : "Link could not be added.",
        requestId,
        projectScoped: true,
      });
    const link = firstRow(data);
    if (!link)
      return apiError(500, "INTERNAL_ERROR", "Link creation returned no link.", { requestId });
    return json({ data: link }, { status: 201 });
  },
);

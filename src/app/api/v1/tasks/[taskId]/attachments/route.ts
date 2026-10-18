import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { createTaskAttachmentSchema } from "@/lib/attachments/schemas";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.reads,
    params: z.object({ taskId: z.string().uuid() }),
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to view attachments.",
  },
  async ({ supabase, params }) => {
    const { data, error } = await supabase
      .from("task_attachments")
      .select("id, task_id, file_name, mime_type, size_bytes, storage_path, created_by, created_at")
      .eq("task_id", params.taskId)
      .order("created_at");
    if (error) return apiError(404, "NOT_FOUND", "Task not found.");
    return json({ data: data ?? [] });
  },
);

// Registers the attachment; the browser then uploads the bytes straight to storage at
// `storage_path`, which keeps large files off the 4.5 MB serverless body limit.
export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ taskId: z.string().uuid() }),
    body: createTaskAttachmentSchema,
    notFoundMessage: "Task not found.",
    unauthenticatedMessage: "Sign in to add attachments.",
    validationMessage: "Use an image, PDF, Office document, text, CSV or zip file up to 10 MB.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("add_task_attachment", {
      p_task_id: params.taskId,
      p_file_name: body.fileName,
      p_mime_type: body.mimeType,
      p_size_bytes: body.sizeBytes,
    });
    if (error)
      return mapRpcError(error, {
        message:
          error.code === "22023"
            ? "That file could not be attached. Check its type and size, or remove an old file if this task has 10."
            : "File could not be attached.",
        requestId,
        projectScoped: true,
      });
    const attachment = firstRow(data);
    if (!attachment)
      return apiError(500, "INTERNAL_ERROR", "Attachment creation returned no row.", { requestId });
    return json({ data: attachment }, { status: 201 });
  },
);

import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "task-attachments";
const params = z.object({ taskId: z.string().uuid(), attachmentId: z.string().uuid() });

// Returns a short-lived signed URL. RLS on task_attachments and on the bucket means only
// project members can resolve it; the file name is forced as the download name.
export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.reads,
    params,
    notFoundMessage: "Attachment not found.",
    unauthenticatedMessage: "Sign in to download attachments.",
  },
  async ({ supabase, params: p }) => {
    const { data: row } = await supabase
      .from("task_attachments")
      .select("storage_path, file_name")
      .eq("id", p.attachmentId)
      .eq("task_id", p.taskId)
      .maybeSingle();
    if (!row) return apiError(404, "NOT_FOUND", "Attachment not found.");
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.storage_path, 60, { download: row.file_name });
    if (error || !data) return apiError(404, "NOT_FOUND", "Attachment not found.");
    return json({ data: { url: data.signedUrl } });
  },
);

export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params,
    notFoundMessage: "Attachment not found.",
    unauthenticatedMessage: "Sign in to remove attachments.",
  },
  async ({ supabase, params: p, requestId }) => {
    const { data: storagePath, error } = await supabase.rpc("delete_task_attachment", {
      p_task_id: p.taskId,
      p_attachment_id: p.attachmentId,
    });
    if (error)
      return mapRpcError(error, {
        message: "Attachment could not be removed.",
        requestId,
        projectScoped: true,
      });
    // The RPC already authorised the caller and removed the row; the object is now orphaned
    // and only the service role may delete it.
    if (typeof storagePath === "string") {
      await createAdminClient().storage.from(BUCKET).remove([storagePath]);
    }
    return new Response(null, { status: 204 });
  },
);

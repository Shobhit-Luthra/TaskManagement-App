import { z } from "zod";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TASK = 10;

// Keep in sync with add_task_attachment and the storage bucket's allowed_mime_types.
export const ALLOWED_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

export const createTaskAttachmentSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1, "Choose a file")
    .max(255, "File names are limited to 255 characters"),
  mimeType: z.enum(ALLOWED_ATTACHMENT_TYPES, {
    message: "That file type is not allowed. Use an image, PDF, Office document, text, CSV or zip.",
  }),
  sizeBytes: z
    .number()
    .int()
    .positive("That file is empty")
    .max(MAX_ATTACHMENT_BYTES, "Files are limited to 10 MB"),
});

export type CreateTaskAttachmentInput = z.infer<typeof createTaskAttachmentSchema>;

export type TaskAttachment = {
  id: string;
  task_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_by: string | null;
  created_at: string;
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

import { z } from "zod";

const HTTP_URL = /^https?:\/\/\S+$/i;

export const createTaskLinkSchema = z.object({
  url: z
    .string()
    .trim()
    .max(2048, "Links are limited to 2048 characters")
    .regex(HTTP_URL, "Use a full link starting with http:// or https://"),
  title: z
    .string()
    .trim()
    .max(200, "Link titles are limited to 200 characters")
    .nullable()
    .optional(),
});

export type CreateTaskLinkInput = z.infer<typeof createTaskLinkSchema>;

export type TaskLink = {
  id: string;
  task_id: string;
  url: string;
  title: string | null;
  created_by: string | null;
  created_at: string;
};

export function linkHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

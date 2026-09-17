import { z } from "zod";

const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour, e.g. #4F46E5.");

export const createLabelSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: colorSchema,
});
export const updateLabelSchema = createLabelSchema;
export const setTaskLabelsSchema = z.object({ labelIds: z.array(z.string().uuid()).max(20) });

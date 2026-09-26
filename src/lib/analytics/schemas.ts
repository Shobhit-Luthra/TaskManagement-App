import { z } from "zod";

export const weeksQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(260).default(12),
});
export const daysQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export const limitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

import { z } from "zod";

const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "Give your project a name")
  .max(120, "Project names are limited to 120 characters");

export const timezoneSchema = z
  .string()
  .trim()
  .min(1, "Choose a timezone")
  .max(64, "Timezone is invalid");

export const createProjectSchema = z.object({
  name: projectNameSchema,
  description: z.preprocess(blankToUndefined, z.string().trim().max(2000).optional()),
  timezone: z.preprocess(blankToUndefined, timezoneSchema.optional()),
});

export const createdProjectSchema = z.object({
  id: z.string().uuid(),
  name: projectNameSchema,
  description: z.string().nullable(),
  timezone: timezoneSchema,
  role: z.literal("owner"),
  columns: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      position: z.number().finite(),
      isDoneColumn: z.boolean(),
      isInProgressColumn: z.boolean(),
    }),
  ),
  created_at: z.string(),
});

export const columnNameSchema = z
  .string()
  .trim()
  .min(1, "Give the column a name")
  .max(60, "Column names are limited to 60 characters");
export const createColumnSchema = z.object({
  name: columnNameSchema,
  wipLimit: z.number().int().positive().nullable().optional(),
});
export const updateColumnSchema = z.object({
  name: columnNameSchema,
  wipLimit: z.number().int().positive().nullable(),
  isDoneColumn: z.boolean(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

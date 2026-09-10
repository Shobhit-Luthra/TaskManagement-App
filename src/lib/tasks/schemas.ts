import { z } from "zod";

export const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export const taskTitleSchema = z
  .string()
  .trim()
  .min(1, "Add a title")
  .max(200, "Titles are limited to 200 characters");
export const finitePositionSchema = z.number().finite("Position must be a finite number");
export const uuidSchema = z.string().uuid("Invalid identifier");

export const createTaskSchema = z.object({
  title: taskTitleSchema,
  columnId: uuidSchema,
  description: z.string().max(20_000).nullable().optional(),
  assigneeId: uuidSchema.nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  priority: taskPrioritySchema.optional(),
  labelIds: z.array(uuidSchema).max(50).optional(),
  position: finitePositionSchema.optional(),
  mutationId: uuidSchema.optional(),
});

export const moveTaskSchema = z.object({
  columnId: uuidSchema,
  position: finitePositionSchema,
  mutationId: uuidSchema,
});

export const updateTaskSchema = z.object({
  title: taskTitleSchema,
  description: z.string().max(20_000).nullable(),
  dueDate: z.string().date().nullable(),
  priority: taskPrioritySchema,
});

export const subtaskTitleSchema = z
  .string()
  .trim()
  .min(1, "Add a subtask title")
  .max(200, "Subtask titles are limited to 200 characters");

export const createSubtaskSchema = z.object({
  title: subtaskTitleSchema,
});

export const updateSubtaskSchema = z
  .object({
    title: subtaskTitleSchema.optional(),
    isCompleted: z.boolean().optional(),
  })
  .refine((value) => value.title !== undefined || value.isCompleted !== undefined, {
    message: "Provide a subtask change",
  });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CreateSubtaskInput = z.infer<typeof createSubtaskSchema>;
export type UpdateSubtaskInput = z.infer<typeof updateSubtaskSchema>;

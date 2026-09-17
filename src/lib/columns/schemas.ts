import { z } from "zod";
import { finitePositionSchema, uuidSchema } from "@/lib/tasks/schemas";

export const moveColumnSchema = z.object({ position: finitePositionSchema });
export const deleteColumnSchema = z.object({ moveTasksTo: uuidSchema });

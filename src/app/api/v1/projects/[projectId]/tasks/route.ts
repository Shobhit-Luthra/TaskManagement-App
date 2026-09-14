import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { createTaskSchema } from "@/lib/tasks/schemas";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.reads,
    params: z.object({ projectId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to view tasks.",
  },
  async ({ supabase, params, requestId }) => {
    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id, column_id, title, description, due_date, priority, position, created_at, updated_at",
      )
      .eq("project_id", params.projectId)
      .is("deleted_at", null)
      .order("position");
    if (error) return apiError(500, "INTERNAL_ERROR", "Tasks could not be loaded.", { requestId });

    return json({ data: data ?? [] });
  },
);

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    params: z.object({ projectId: z.string().uuid() }),
    body: createTaskSchema,
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to create a task.",
    validationMessage: "Check the task details and try again.",
  },
  async ({ supabase, params, body, requestId }) => {
    const { data, error } = await supabase.rpc("create_task", {
      p_project_id: params.projectId,
      p_column_id: body.columnId,
      p_title: body.title,
      p_description: body.description ?? null,
      p_assignee_id: body.assigneeId ?? null,
      p_due_date: body.dueDate ?? null,
      p_priority: body.priority ?? "medium",
      p_position: body.position ?? null,
      p_mutation_id: body.mutationId ?? null,
    });
    if (error) return mapRpcError(error, { message: "Task could not be created.", requestId });

    const task = firstRow(data);
    if (!task)
      return apiError(500, "INTERNAL_ERROR", "Task creation returned no task.", { requestId });
    return json({ data: task }, { status: 201 });
  },
);

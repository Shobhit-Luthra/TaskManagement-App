import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { clientEnv } from "@/lib/env";
import { updateTaskSchema } from "@/lib/tasks/schemas";
import { createClient } from "@/lib/supabase/server";

const taskIdSchema = z.string().uuid();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const taskId = taskIdSchema.safeParse((await params).taskId);
  if (!taskId.success) return apiError(404, "NOT_FOUND", "Task not found.");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(clientEnv.NEXT_PUBLIC_SITE_URL).origin) {
    return apiError(403, "NOT_FOUND", "This resource was not found.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(422, "VALIDATION_ERROR", "Provide valid task details.");
  }
  const input = updateTaskSchema.safeParse(body);
  if (!input.success) {
    return apiError(
      422,
      "VALIDATION_ERROR",
      "Check the task details and try again.",
      input.error.flatten(),
    );
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return apiError(401, "UNAUTHENTICATED", "Sign in to update tasks.");
  const { data, error } = await supabase.rpc("update_task", {
    p_task_id: taskId.data,
    p_title: input.data.title,
    p_description: input.data.description,
    p_due_date: input.data.dueDate,
    p_priority: input.data.priority,
  });
  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "42501" ? 403 : 422;
    const code = status === 404 ? "NOT_FOUND" : status === 403 ? "FORBIDDEN" : "VALIDATION_ERROR";
    return apiError(status, code, "Task could not be updated.");
  }
  const task = Array.isArray(data) ? data[0] : data;
  if (!task) return apiError(500, "INTERNAL_ERROR", "Task update returned no task.");
  return NextResponse.json({ data: task });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const taskId = taskIdSchema.safeParse((await params).taskId);
  if (!taskId.success) return apiError(404, "NOT_FOUND", "Task not found.");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(clientEnv.NEXT_PUBLIC_SITE_URL).origin) {
    return apiError(403, "NOT_FOUND", "This resource was not found.");
  }
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return apiError(401, "UNAUTHENTICATED", "Sign in to delete tasks.");
  const { error } = await supabase.rpc("soft_delete_task", { p_task_id: taskId.data });
  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "42501" ? 403 : 422;
    const code = status === 404 ? "NOT_FOUND" : status === 403 ? "FORBIDDEN" : "VALIDATION_ERROR";
    return apiError(status, code, "Task could not be deleted.");
  }
  return new NextResponse(null, { status: 204 });
}

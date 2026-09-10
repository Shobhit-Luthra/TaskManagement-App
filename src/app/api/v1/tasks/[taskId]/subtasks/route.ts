import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { clientEnv } from "@/lib/env";
import { createSubtaskSchema } from "@/lib/tasks/schemas";
import { createClient } from "@/lib/supabase/server";

const taskIdSchema = z.string().uuid();

export async function GET(_: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const taskId = taskIdSchema.safeParse((await params).taskId);
  if (!taskId.success) return apiError(404, "NOT_FOUND", "Task not found.");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return apiError(401, "UNAUTHENTICATED", "Sign in to view subtasks.");
  const { data, error } = await supabase
    .from("subtasks")
    .select("id, task_id, title, is_completed, position, created_at, updated_at")
    .eq("task_id", taskId.data)
    .order("position");
  if (error) return apiError(404, "NOT_FOUND", "Task not found.");
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const taskId = taskIdSchema.safeParse((await params).taskId);
  if (!taskId.success) return apiError(404, "NOT_FOUND", "Task not found.");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(clientEnv.NEXT_PUBLIC_SITE_URL).origin)
    return apiError(403, "NOT_FOUND", "This resource was not found.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(422, "VALIDATION_ERROR", "Provide valid subtask details.");
  }
  const input = createSubtaskSchema.safeParse(body);
  if (!input.success)
    return apiError(
      422,
      "VALIDATION_ERROR",
      "Check the subtask and try again.",
      input.error.flatten(),
    );
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return apiError(401, "UNAUTHENTICATED", "Sign in to add subtasks.");
  const { data, error } = await supabase.rpc("create_subtask", {
    p_task_id: taskId.data,
    p_title: input.data.title,
  });
  if (error)
    return apiError(
      error.code === "42501" ? 403 : 422,
      error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR",
      "Subtask could not be created.",
    );
  const subtask = Array.isArray(data) ? data[0] : data;
  if (!subtask) return apiError(500, "INTERNAL_ERROR", "Subtask creation returned no subtask.");
  return NextResponse.json({ data: subtask }, { status: 201 });
}

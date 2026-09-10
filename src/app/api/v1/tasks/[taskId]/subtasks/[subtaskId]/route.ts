import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { clientEnv } from "@/lib/env";
import { updateSubtaskSchema } from "@/lib/tasks/schemas";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.string().uuid();

async function ids(params: Promise<{ taskId: string; subtaskId: string }>) {
  const resolved = await params;
  return {
    taskId: idSchema.safeParse(resolved.taskId),
    subtaskId: idSchema.safeParse(resolved.subtaskId),
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string; subtaskId: string }> },
) {
  const parsed = await ids(params);
  if (!parsed.taskId.success || !parsed.subtaskId.success)
    return apiError(404, "NOT_FOUND", "Subtask not found.");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(clientEnv.NEXT_PUBLIC_SITE_URL).origin)
    return apiError(403, "NOT_FOUND", "This resource was not found.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(422, "VALIDATION_ERROR", "Provide valid subtask details.");
  }
  const input = updateSubtaskSchema.safeParse(body);
  if (!input.success)
    return apiError(
      422,
      "VALIDATION_ERROR",
      "Check the subtask and try again.",
      input.error.flatten(),
    );
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return apiError(401, "UNAUTHENTICATED", "Sign in to update subtasks.");
  const { data, error } = await supabase.rpc("update_subtask", {
    p_task_id: parsed.taskId.data,
    p_subtask_id: parsed.subtaskId.data,
    p_title: input.data.title ?? null,
    p_is_completed: input.data.isCompleted ?? null,
  });
  if (error)
    return apiError(
      error.code === "P0002" ? 404 : error.code === "42501" ? 403 : 422,
      error.code === "P0002"
        ? "NOT_FOUND"
        : error.code === "42501"
          ? "FORBIDDEN"
          : "VALIDATION_ERROR",
      "Subtask could not be updated.",
    );
  return NextResponse.json({ data: Array.isArray(data) ? data[0] : data });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string; subtaskId: string }> },
) {
  const parsed = await ids(params);
  if (!parsed.taskId.success || !parsed.subtaskId.success)
    return apiError(404, "NOT_FOUND", "Subtask not found.");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(clientEnv.NEXT_PUBLIC_SITE_URL).origin)
    return apiError(403, "NOT_FOUND", "This resource was not found.");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return apiError(401, "UNAUTHENTICATED", "Sign in to delete subtasks.");
  const { error } = await supabase.rpc("delete_subtask", {
    p_task_id: parsed.taskId.data,
    p_subtask_id: parsed.subtaskId.data,
  });
  if (error)
    return apiError(
      error.code === "P0002" ? 404 : error.code === "42501" ? 403 : 422,
      error.code === "P0002"
        ? "NOT_FOUND"
        : error.code === "42501"
          ? "FORBIDDEN"
          : "VALIDATION_ERROR",
      "Subtask could not be deleted.",
    );
  return new NextResponse(null, { status: 204 });
}

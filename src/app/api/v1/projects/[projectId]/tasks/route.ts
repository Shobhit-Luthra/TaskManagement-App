import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { createTaskSchema } from "@/lib/tasks/schemas";
import { clientEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const projectIdSchema = z.string().uuid();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const projectId = projectIdSchema.safeParse((await params).projectId);
  if (!projectId.success) return apiError(404, "NOT_FOUND", "Project not found.");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return apiError(401, "UNAUTHENTICATED", "Sign in to view tasks.");

  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, column_id, title, description, due_date, priority, position, created_at, updated_at",
    )
    .eq("project_id", projectId.data)
    .is("deleted_at", null)
    .order("position");
  if (error) return apiError(500, "INTERNAL_ERROR", "Tasks could not be loaded.");

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const projectId = projectIdSchema.safeParse((await params).projectId);
  if (!projectId.success) return apiError(404, "NOT_FOUND", "Project not found.");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(clientEnv.NEXT_PUBLIC_SITE_URL).origin) {
    return apiError(403, "NOT_FOUND", "This resource was not found.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(422, "VALIDATION_ERROR", "Provide a valid task payload.");
  }
  const input = createTaskSchema.safeParse(body);
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
  if (!auth.user) return apiError(401, "UNAUTHENTICATED", "Sign in to create a task.");

  const { data, error } = await supabase.rpc("create_task", {
    p_project_id: projectId.data,
    p_column_id: input.data.columnId,
    p_title: input.data.title,
    p_description: input.data.description ?? null,
    p_assignee_id: input.data.assigneeId ?? null,
    p_due_date: input.data.dueDate ?? null,
    p_priority: input.data.priority ?? "medium",
    p_position: input.data.position ?? null,
    p_mutation_id: input.data.mutationId ?? null,
  });
  if (error) {
    const status = error.code === "42501" || error.code === "28000" ? 403 : 422;
    return apiError(
      status,
      status === 403 ? "FORBIDDEN" : "VALIDATION_ERROR",
      "Task could not be created.",
    );
  }

  const task = Array.isArray(data) ? data[0] : data;
  if (!task) return apiError(500, "INTERNAL_ERROR", "Task creation returned no task.");
  return NextResponse.json({ data: task }, { status: 201 });
}

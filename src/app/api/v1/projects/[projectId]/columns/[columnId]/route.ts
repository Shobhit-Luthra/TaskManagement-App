import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { clientEnv } from "@/lib/env";
import { updateColumnSchema } from "@/lib/projects/schemas";
import { createClient } from "@/lib/supabase/server";

const id = z.string().uuid();
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; columnId: string }> },
) {
  const values = await params;
  const projectId = id.safeParse(values.projectId);
  const columnId = id.safeParse(values.columnId);
  if (!projectId.success || !columnId.success)
    return apiError(404, "NOT_FOUND", "Column not found.");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(clientEnv.NEXT_PUBLIC_SITE_URL).origin)
    return apiError(403, "NOT_FOUND", "This resource was not found.");
  const input = updateColumnSchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return apiError(
      422,
      "VALIDATION_ERROR",
      "Check the column and try again.",
      input.error.flatten(),
    );
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return apiError(401, "UNAUTHENTICATED", "Sign in to manage columns.");
  const { data, error } = await supabase.rpc("update_project_column", {
    p_project_id: projectId.data,
    p_column_id: columnId.data,
    p_name: input.data.name,
    p_wip_limit: input.data.wipLimit,
    p_is_done_column: input.data.isDoneColumn,
  });
  if (error)
    return apiError(
      error.code === "P0002" ? 404 : error.code === "42501" ? 403 : 422,
      error.code === "P0002"
        ? "NOT_FOUND"
        : error.code === "42501"
          ? "FORBIDDEN"
          : "VALIDATION_ERROR",
      "Column could not be updated.",
    );
  return NextResponse.json({ data: Array.isArray(data) ? data[0] : data });
}

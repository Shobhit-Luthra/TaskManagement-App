import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { clientEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const projectIdSchema = z.string().uuid();
const updateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable(),
  timezone: z.string().trim().min(1).max(64),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const projectId = projectIdSchema.safeParse((await params).projectId);
  if (!projectId.success) return apiError(404, "NOT_FOUND", "Project not found.");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(clientEnv.NEXT_PUBLIC_SITE_URL).origin)
    return apiError(403, "NOT_FOUND", "This resource was not found.");
  const input = updateSchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return apiError(
      422,
      "VALIDATION_ERROR",
      "Check the project details and try again.",
      input.error.flatten(),
    );
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return apiError(401, "UNAUTHENTICATED", "Sign in to update projects.");
  const { data, error } = await supabase.rpc("update_project", {
    p_project_id: projectId.data,
    p_name: input.data.name,
    p_description: input.data.description,
    p_timezone: input.data.timezone,
  });
  if (error)
    return apiError(
      error.code === "42501" ? 403 : 422,
      error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR",
      "Project could not be updated.",
    );
  return NextResponse.json({ data: Array.isArray(data) ? data[0] : data });
}

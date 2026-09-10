import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { createProjectSchema, createdProjectSchema } from "@/lib/projects/schemas";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
  includeArchived: z.enum(["true", "false"]).default("false"),
});

export async function GET(request: NextRequest) {
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) {
    return apiError(422, "VALIDATION_ERROR", "Invalid project-list query.", query.error.flatten());
  }

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return apiError(401, "UNAUTHENTICATED", "Sign in to view projects.");

  let projectsQuery = supabase
    .from("projects")
    .select("id, name, description, owner_id, timezone, is_archived, created_at, updated_at")
    .is("deleted_at", null)
    .order("id", { ascending: true })
    .limit(query.data.limit + 1);

  if (query.data.includeArchived === "false")
    projectsQuery = projectsQuery.eq("is_archived", false);
  if (query.data.cursor) projectsQuery = projectsQuery.gt("id", query.data.cursor);

  const { data, error } = await projectsQuery;
  if (error) return apiError(500, "INTERNAL_ERROR", "Projects could not be loaded.");

  const hasMore = (data?.length ?? 0) > query.data.limit;
  const items = (data ?? []).slice(0, query.data.limit);
  return NextResponse.json({
    data: items,
    pagination: { nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null, hasMore },
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(clientEnv.NEXT_PUBLIC_SITE_URL).origin) {
    return apiError(403, "NOT_FOUND", "This resource was not found.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(422, "VALIDATION_ERROR", "Provide a valid JSON project payload.");
  }
  const input = createProjectSchema.safeParse(body);
  if (!input.success) {
    return apiError(422, "VALIDATION_ERROR", "Invalid project details.", input.error.flatten());
  }

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user)
    return apiError(401, "UNAUTHENTICATED", "Sign in to create a project.");

  const { data, error } = await supabase.rpc("create_project", {
    p_name: input.data.name,
    p_description: input.data.description ?? null,
    p_timezone: input.data.timezone ?? "UTC",
  });
  if (error) return apiError(500, "INTERNAL_ERROR", "Project creation could not be completed.");

  const project = createdProjectSchema.safeParse(Array.isArray(data) ? data[0] : data);
  if (!project.success)
    return apiError(500, "INTERNAL_ERROR", "Project creation returned an invalid result.");
  return NextResponse.json({ data: project.data }, { status: 201 });
}

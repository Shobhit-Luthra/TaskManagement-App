import { z } from "zod";
import { apiError } from "@/lib/api/response";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { createProjectSchema, createdProjectSchema } from "@/lib/projects/schemas";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
  includeArchived: z.enum(["true", "false"]).default("false"),
});

export const GET = withApiHandler(
  { unauthenticatedMessage: "Sign in to view projects.", rateLimit: RATE_LIMITS.reads },
  async ({ request, supabase, requestId }) => {
    const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!query.success) {
      return apiError(
        422,
        "VALIDATION_ERROR",
        "Invalid project-list query.",
        query.error.flatten(),
      );
    }

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
    if (error)
      return apiError(500, "INTERNAL_ERROR", "Projects could not be loaded.", { requestId });

    const hasMore = (data?.length ?? 0) > query.data.limit;
    const items = (data ?? []).slice(0, query.data.limit);
    return json({
      data: items,
      pagination: { nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null, hasMore },
    });
  },
);

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    body: createProjectSchema,
    unauthenticatedMessage: "Sign in to create a project.",
    validationMessage: "Invalid project details.",
  },
  async ({ supabase, body, requestId }) => {
    const { data, error } = await supabase.rpc("create_project", {
      p_name: body.name,
      p_description: body.description ?? null,
      p_timezone: body.timezone ?? "UTC",
    });
    if (error)
      return mapRpcError(error, { message: "Project creation could not be completed.", requestId });

    const project = createdProjectSchema.safeParse(Array.isArray(data) ? data[0] : data);
    if (!project.success)
      return apiError(500, "INTERNAL_ERROR", "Project creation returned an invalid result.", {
        requestId,
      });
    return json({ data: project.data }, { status: 201 });
  },
);

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { json, mapRpcError } from "@/lib/api/handler";
import { apiError } from "@/lib/api/response";

export const calendarQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  undated: z.enum(["0", "1"]).optional(),
});

export async function loadCalendar({
  supabase,
  request,
  requestId,
  projectId,
}: {
  supabase: SupabaseClient;
  request: NextRequest;
  requestId: string;
  projectId: string | null;
}): Promise<Response> {
  const query = calendarQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) {
    return apiError(422, "VALIDATION_ERROR", "Choose a valid date range.", query.error.flatten());
  }
  const { data, error } = await supabase.rpc("calendar_tasks", {
    p_project_id: projectId,
    p_from: query.data.from,
    p_to: query.data.to,
    p_include_undated: query.data.undated === "1",
  });
  if (error)
    return mapRpcError(error, {
      message: projectId ? "Calendar could not be loaded." : "Your calendar could not be loaded.",
      requestId,
      projectScoped: projectId !== null,
    });
  return json({ data: data ?? [] });
}

import { apiError } from "@/lib/api/response";
import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { consumeRateLimit, ipSubject, RATE_LIMITS } from "@/lib/api/rate-limit";
import { INVALID_CODE_MESSAGE, requestToJoinSchema } from "@/lib/join-codes/schemas";

type JoinRequestRow = { request_id: string; project_name: string; status: string };

// The caller's own pending requests (non-members can't read projects via RLS).
export const GET = withApiHandler(
  { rateLimit: RATE_LIMITS.reads, unauthenticatedMessage: "Sign in to see your requests." },
  async ({ supabase, requestId }) => {
    const { data, error } = await supabase.rpc("list_my_join_requests");
    if (error) return mapRpcError(error, { message: "Requests could not be loaded.", requestId });
    return json({ data: data ?? [] });
  },
);

// A 6-digit code is guessable, so besides the per-user window applied by
// withApiHandler this route also enforces a per-user daily cap and a per-IP
// cap before the code ever reaches the database. Every "no such usable code"
// case returns the same 404 so a caller can't tell real codes from fake ones.
export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.joinCode,
    body: requestToJoinSchema,
    unauthenticatedMessage: "Sign in to join a board.",
    validationMessage: "Enter the 6-digit code.",
  },
  async ({ request, user, supabase, body, requestId }) => {
    const extraLimits = [
      [RATE_LIMITS.joinCodeDaily, user.id],
      [RATE_LIMITS.joinCodeIp, ipSubject(request)],
    ] as const;
    for (const [policy, subject] of extraLimits) {
      const result = await consumeRateLimit(policy, subject);
      if (!result.allowed) {
        return apiError(429, "RATE_LIMITED", "Too many attempts. Try again later.");
      }
    }

    const { data, error } = await supabase.rpc("request_to_join", { p_code: body.code });
    if (error) {
      if (error.code === "P0002" || error.code === "22023") {
        return apiError(404, "NOT_FOUND", INVALID_CODE_MESSAGE);
      }
      if (error.code === "23505") {
        return apiError(409, "CONFLICT", "You're already a member of this board.");
      }
      if (error.code === "P0003") {
        return apiError(
          409,
          "CONFLICT",
          "This board has too many pending requests. Ask an admin to review them.",
        );
      }
      return mapRpcError(error, { message: "Your request could not be sent.", requestId });
    }
    const row = firstRow(data as JoinRequestRow[] | null);
    if (!row)
      return apiError(500, "INTERNAL_ERROR", "Join request returned no row.", { requestId });
    return json(
      { data: { requestId: row.request_id, projectName: row.project_name, status: row.status } },
      { status: 202 },
    );
  },
);

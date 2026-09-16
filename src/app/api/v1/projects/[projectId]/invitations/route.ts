import { createHash } from "node:crypto";
import { z } from "zod";
import { json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { withIdempotency } from "@/lib/api/idempotency";
import { apiError } from "@/lib/api/response";
import { createInvitationSchema } from "@/lib/invitations/schemas";
import { generateInviteToken } from "@/lib/invitations/token";
import { getEmailSender } from "@/lib/email";
import { invitationEmail } from "@/lib/email/templates/invitation";
import { clientEnv } from "@/lib/env";

export const GET = withApiHandler(
  {
    rateLimit: RATE_LIMITS.reads,
    params: z.object({ projectId: z.string().uuid() }),
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to view invitations.",
  },
  async ({ supabase, params, requestId }) => {
    const { data, error } = await supabase
      .from("invitations")
      .select("id, project_id, email, role, expires_at, created_at, accepted_at")
      .eq("project_id", params.projectId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });
    if (error)
      return apiError(500, "INTERNAL_ERROR", "Invitations could not be loaded.", { requestId });
    return json({ data });
  },
);

export const POST = withApiHandler(
  {
    rateLimit: RATE_LIMITS.invitations,
    params: z.object({ projectId: z.string().uuid() }),
    body: createInvitationSchema,
    notFoundMessage: "Project not found.",
    unauthenticatedMessage: "Sign in to send invitations.",
    validationMessage: "Check the invitation details and try again.",
  },
  async ({ supabase, params, body, user, request, requestId }) => {
    const idempotencyKey = request.headers.get("idempotency-key");
    const requestHash = createHash("sha256").update(JSON.stringify({ params, body })).digest("hex");

    const run = async () => {
      const { token, hash } = generateInviteToken();
      const { data, error } = await supabase.rpc("create_invitation", {
        p_project_id: params.projectId,
        p_email: body.email,
        p_role: body.role,
        p_token_hash: hash,
      });
      if (error) {
        const response = mapRpcError(error, {
          message: "Invitation could not be created.",
          requestId,
          projectScoped: true,
        });
        return { status: response.status, body: await response.json() };
      }
      const row = Array.isArray(data) ? data[0] : data;

      const { data: project } = await supabase
        .from("projects")
        .select("name")
        .eq("id", params.projectId)
        .single();
      const { data: inviter } = await supabase
        .from("users")
        .select("display_name")
        .eq("id", user.id)
        .single();
      const sender = getEmailSender();
      const email = invitationEmail({
        projectName: project?.name ?? "a Kanbo project",
        inviterDisplayName: inviter?.display_name ?? "A teammate",
        role: row.role,
        acceptUrl: `${clientEnv.NEXT_PUBLIC_SITE_URL}/invite/${token}`,
      });
      await sender.send({ to: body.email, ...email, category: "transactional" });

      return { status: row.resent ? 200 : 201, body: { data: row } };
    };

    const result = idempotencyKey
      ? await withIdempotency({ userId: user.id, key: idempotencyKey, requestHash }, run)
      : await run();

    if (result.status >= 400)
      return apiError(
        result.status,
        (result.body as { error: { code: string } }).error.code as never,
        (result.body as { error: { message: string } }).error.message,
      );
    return json(result.body, { status: result.status });
  },
);

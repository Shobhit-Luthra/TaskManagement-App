import { firstRow, json, mapRpcError, withApiHandler } from "@/lib/api/handler";
import { apiError } from "@/lib/api/response";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

const BAN_FOREVER = "876000h";

function parseBlockedProjects(details: unknown): unknown[] {
  if (typeof details !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(details);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const DELETE = withApiHandler(
  {
    rateLimit: RATE_LIMITS.writes,
    unauthenticatedMessage: "Sign in to delete your account.",
  },
  async ({ supabase, user, requestId }) => {
    const { data, error } = await supabase.rpc("delete_own_account");
    if (error) {
      if (error.code === "42501") {
        return apiError(
          409,
          "CONFLICT",
          "You're the only Owner on one or more projects. Transfer ownership or delete those projects before deleting your account.",
          { blockedProjects: parseBlockedProjects(error.details) },
        );
      }
      return mapRpcError(error, { message: "Account could not be deleted.", requestId });
    }
    const row = firstRow(data as { deleted: boolean; tombstone_email: string }[] | null);
    if (!row?.deleted) {
      return apiError(500, "INTERNAL_ERROR", "Account could not be deleted.", { requestId });
    }

    // The profile row is anonymised by the RPC; the auth record must follow so the
    // credentials stop working and the real email is freed for a fresh sign-up.
    const admin = createAdminClient();
    const banned = await admin.auth.admin.updateUserById(user.id, {
      email: row.tombstone_email,
      email_confirm: true,
      ban_duration: BAN_FOREVER,
      user_metadata: { display_name: "Deleted user" },
    });
    if (banned.error) {
      log("error", "account.delete.auth_update_failed", { requestId, userId: user.id });
      return apiError(500, "INTERNAL_ERROR", "Account could not be deleted.", { requestId });
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) {
      await admin.auth.admin.signOut(sessionData.session.access_token, "global");
    }
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);

    return json({ data: { deleted: true } });
  },
);

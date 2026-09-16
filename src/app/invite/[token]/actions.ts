"use server";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function peekInvite(token: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("peek_invitation", { p_token_hash: hashToken(token) });
  if (error) return { error: error.code === "P0003" ? ("gone" as const) : ("not_found" as const) };
  const row = Array.isArray(data) ? data[0] : data;
  return { data: row };
}

export async function acceptInvite(token: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    const jar = await cookies();
    jar.set("kanbo_invite", token, { httpOnly: true, maxAge: 3600, path: "/", sameSite: "lax" });
    return { redirect: `/signup?next=/invite/${token}` };
  }
  const { data, error } = await supabase.rpc("accept_invitation", {
    p_token_hash: hashToken(token),
  });
  if (error) return { error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  return { redirect: `/p/${row.project_id}/board` };
}

export async function declineInvite(token: string) {
  const supabase = await createClient();
  await supabase.rpc("decline_invitation", { p_token_hash: hashToken(token) });
  return { redirect: "/projects" };
}

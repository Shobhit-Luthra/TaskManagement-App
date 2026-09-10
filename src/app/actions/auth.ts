"use server";

import { redirect } from "next/navigation";
import { mapAuthError } from "@/lib/auth/errors";
import {
  resetPasswordSchema,
  resetRequestSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";

export type ActionState = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };

function validationState(error: {
  flatten: () => { fieldErrors: Record<string, string[] | undefined> };
}): ActionState {
  const fieldErrors = Object.fromEntries(
    Object.entries(error.flatten().fieldErrors).flatMap(([key, values]) =>
      values?.[0] ? [[key, values[0]]] : [],
    ),
  );
  return { ok: false, message: "Please correct the highlighted fields.", fieldErrors };
}

function safeNext(value: FormDataEntryValue | null): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/projects";
}

export async function signUp(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationState(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${clientEnv.NEXT_PUBLIC_SITE_URL}/auth/confirm`,
      data: { display_name: parsed.data.displayName },
    },
  });
  if (error) return { ok: false, message: mapAuthError(error) };
  redirect(`/verify-email?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function signIn(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationState(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, message: mapAuthError(error) };
  redirect(safeNext(formData.get("next")));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationState(parsed.error);
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${clientEnv.NEXT_PUBLIC_SITE_URL}/auth/confirm?type=recovery`,
  });
  return { ok: true, message: "If that address has an account, a reset link is on its way." };
}

export async function resetPassword(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationState(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, message: mapAuthError(error) };
  redirect("/login?reset=success");
}

export async function resendVerification(_: ActionState, formData: FormData): Promise<ActionState> {
  const email = formData.get("email");
  if (typeof email === "string" && resetRequestSchema.safeParse({ email }).success) {
    const supabase = await createClient();
    await supabase.auth.resend({ type: "signup", email });
  }
  return { ok: true, message: "If that address is eligible, a verification email is on its way." };
}

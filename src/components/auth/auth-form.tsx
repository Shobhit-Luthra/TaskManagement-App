"use client";

import Link from "next/link";
import { type ReactNode, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ActionState } from "@/app/actions/auth";

type Field = { name: string; label: string; type?: string; autoComplete?: string };
export function AuthForm({
  action,
  fields,
  submit,
  footer,
  next,
}: {
  action: (state: ActionState, data: FormData) => Promise<ActionState>;
  fields: Field[];
  submit: string;
  footer?: ReactNode;
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false });
  return (
    <form action={formAction} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      {fields.map((field) => (
        <div key={field.name} className="space-y-2">
          <Label htmlFor={field.name}>{field.label}</Label>
          <Input
            id={field.name}
            name={field.name}
            type={field.type ?? "text"}
            autoComplete={field.autoComplete}
            required
            aria-describedby={state.fieldErrors?.[field.name] ? `${field.name}-error` : undefined}
          />
          {state.fieldErrors?.[field.name] && (
            <p id={`${field.name}-error`} className="text-destructive text-sm">
              {state.fieldErrors[field.name]}
            </p>
          )}
        </div>
      ))}
      {state.message && (
        <p
          role="alert"
          className={state.ok ? "text-muted-foreground text-sm" : "text-destructive text-sm"}
        >
          {state.message}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Please wait…" : submit}
      </Button>
      {footer && <p className="text-muted-foreground text-center text-sm">{footer}</p>}
    </form>
  );
}

export const SignUpFooter = (
  <>
    <Link href="/login" className="underline">
      Already have an account? Sign in
    </Link>
  </>
);
export const SignInFooter = (
  <>
    <Link href="/forgot-password" className="underline">
      Forgot your password?
    </Link>{" "}
    ·{" "}
    <Link href="/signup" className="underline">
      Create an account
    </Link>
  </>
);

import Link from "next/link";
import { AuthFormShell } from "@/components/auth/auth-form-shell";
import { AuthForm } from "@/components/auth/auth-form";
import { requestPasswordReset } from "@/app/actions/auth";

export default function ForgotPasswordPage() {
  return (
    <AuthFormShell title="Reset your password" description="We'll send you a secure reset link">
      <AuthForm
        action={requestPasswordReset}
        submit="Send reset link"
        fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]}
        footer={
          <Link href="/login" className="underline">
            Back to sign in
          </Link>
        }
      />
    </AuthFormShell>
  );
}

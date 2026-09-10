import { AuthFormShell } from "@/components/auth/auth-form-shell";
import { AuthForm } from "@/components/auth/auth-form";
import { resendVerification } from "@/app/actions/auth";

export default function VerifyEmailPage() {
  return (
    <AuthFormShell
      title="Check your inbox"
      description="Use the verification link we sent to continue."
    >
      <AuthForm
        action={resendVerification}
        submit="Resend verification email"
        fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]}
      />
    </AuthFormShell>
  );
}

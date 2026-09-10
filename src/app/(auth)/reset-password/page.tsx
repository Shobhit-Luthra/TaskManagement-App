import { AuthFormShell } from "@/components/auth/auth-form-shell";
import { AuthForm } from "@/components/auth/auth-form";
import { resetPassword } from "@/app/actions/auth";

export default function ResetPasswordPage() {
  return (
    <AuthFormShell title="Choose a new password" description="Use at least 10 characters">
      <AuthForm
        action={resetPassword}
        submit="Update password"
        fields={[
          {
            name: "password",
            label: "New password",
            type: "password",
            autoComplete: "new-password",
          },
          {
            name: "confirmPassword",
            label: "Confirm password",
            type: "password",
            autoComplete: "new-password",
          },
        ]}
      />
    </AuthFormShell>
  );
}

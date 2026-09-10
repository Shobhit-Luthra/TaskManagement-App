import { AuthFormShell } from "@/components/auth/auth-form-shell";
import { AuthForm, SignUpFooter } from "@/components/auth/auth-form";
import { signUp } from "@/app/actions/auth";

export default function SignupPage() {
  return (
    <AuthFormShell title="Create your account" description="Start organizing your team's work">
      <AuthForm
        action={signUp}
        submit="Create account"
        fields={[
          { name: "displayName", label: "Name", autoComplete: "name" },
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          { name: "password", label: "Password", type: "password", autoComplete: "new-password" },
        ]}
        footer={SignUpFooter}
      />
    </AuthFormShell>
  );
}

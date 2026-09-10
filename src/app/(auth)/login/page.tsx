import { AuthFormShell } from "@/components/auth/auth-form-shell";
import { AuthForm, SignInFooter } from "@/components/auth/auth-form";
import { signIn } from "@/app/actions/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <AuthFormShell title="Welcome back" description="Sign in to your Kanbo workspace">
      <AuthForm
        action={signIn}
        submit="Sign in"
        next={next}
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          {
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "current-password",
          },
        ]}
        footer={SignInFooter}
      />
    </AuthFormShell>
  );
}

import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const [{ data: auth }, { data: projects }] = await Promise.all([
    getAuthUser(),
    supabase
      .from("projects")
      .select("id, name")
      .is("deleted_at", null)
      .eq("is_archived", false)
      .order("updated_at", { ascending: false })
      .limit(10),
  ]);
  if (!auth.user) redirect("/login");
  if (!auth.user.email_confirmed_at) redirect("/verify-email");
  return (
    <AppShell
      email={auth.user.email ?? "Signed in"}
      userId={auth.user.id}
      projects={projects ?? []}
    >
      {children}
    </AppShell>
  );
}

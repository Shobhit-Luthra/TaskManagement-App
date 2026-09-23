import Link from "next/link";
import { redirect } from "next/navigation";
import { DeleteAccount } from "@/components/settings/delete-account";
import { createClient } from "@/lib/supabase/server";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("users")
    .select("display_name, email")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Link href="/projects" className="text-muted-foreground hover:text-foreground text-sm">
        ← Back to projects
      </Link>
      <h1 className="text-headline-lg-mobile sm:text-headline-lg mt-6 font-serif font-medium">
        Account
      </h1>
      <dl className="bg-card mt-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-xl border p-5 text-sm">
        <dt className="text-muted-foreground">Name</dt>
        <dd>{profile?.display_name ?? "—"}</dd>
        <dt className="text-muted-foreground">Email</dt>
        <dd className="truncate">{profile?.email ?? user.email ?? "—"}</dd>
      </dl>
      <DeleteAccount />
    </main>
  );
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MembersPageClient } from "./members-page-client";

export default async function MembersSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user!.id)
    .single();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Link
        href={`/p/${projectId}/settings`}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← Back to settings
      </Link>
      <MembersPageClient
        projectId={projectId}
        currentUserId={auth.user!.id}
        currentUserRole={membership?.role ?? "viewer"}
      />
    </main>
  );
}

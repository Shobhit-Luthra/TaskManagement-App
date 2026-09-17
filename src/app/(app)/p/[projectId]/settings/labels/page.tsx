import Link from "next/link";
import { notFound } from "next/navigation";
import { LabelsSettingsClient } from "@/components/labels/labels-settings-client";
import { createClient } from "@/lib/supabase/server";

export default async function LabelsSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!membership) notFound();
  const canManage = membership.role === "owner" || membership.role === "admin";
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Link
        href={`/p/${projectId}/settings`}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← Back to settings
      </Link>
      <LabelsSettingsClient projectId={projectId} canManage={canManage} />
    </main>
  );
}

"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MemberAvatarStack } from "@/components/members/member-avatar-stack";
import { InviteDialog } from "@/components/members/invite-dialog";

export function BoardHeaderInvite({
  projectId,
  members,
  canInvite,
}: {
  projectId: string;
  members: { userId: string; displayName: string }[];
  canInvite: boolean;
}) {
  const [open, setOpen] = useState(false);

  async function handleInvite(input: { email: string; role: "admin" | "member" | "viewer" }) {
    const response = await fetch(`/api/v1/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(body?.error?.message ?? "The invitation could not be sent.");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <MemberAvatarStack members={members} />
      {canInvite && (
        <Button size="sm" onClick={() => setOpen(true)}>
          Invite
        </Button>
      )}
      <InviteDialog open={open} onOpenChange={setOpen} onInvite={handleInvite} />
    </div>
  );
}

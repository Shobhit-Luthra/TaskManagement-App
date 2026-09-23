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

  async function handleInvite(input: {
    email: string;
    role: "admin" | "member" | "viewer";
  }): Promise<{ acceptUrl: string }> {
    const response = await fetch(`/api/v1/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await response.json().catch(() => null)) as {
      data?: { acceptUrl: string };
      error?: { message?: string };
    } | null;
    if (!response.ok || !body?.data)
      throw new Error(body?.error?.message ?? "The invitation could not be sent.");
    return { acceptUrl: body.data.acceptUrl };
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

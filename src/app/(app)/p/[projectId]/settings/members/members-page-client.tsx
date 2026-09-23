"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MembersTable, type MemberRow } from "@/components/members/members-table";
import { InviteDialog } from "@/components/members/invite-dialog";
import {
  PendingInvitations,
  type PendingInvitation,
} from "@/components/members/pending-invitations";

type CallerRole = "owner" | "admin" | "member" | "viewer";

type MemberApiRow = {
  user_id: string;
  role: MemberRow["role"];
  project_peers: { id: string; display_name: string; avatar_url: string | null } | null;
};

type InvitationApiRow = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
};

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return body?.error?.message ?? fallback;
}

async function fetchMembersAndInvitations(
  projectId: string,
  canManage: boolean,
): Promise<{ members: MemberRow[]; invitations: PendingInvitation[] }> {
  const [membersResponse, invitationsResponse] = await Promise.all([
    fetch(`/api/v1/projects/${projectId}/members`),
    canManage ? fetch(`/api/v1/projects/${projectId}/invitations`) : Promise.resolve(null),
  ]);
  if (!membersResponse.ok)
    throw new Error(await readError(membersResponse, "Members could not be loaded."));
  const membersBody = (await membersResponse.json()) as { data: MemberApiRow[] };
  const members = membersBody.data.map((row) => ({
    userId: row.user_id,
    role: row.role,
    displayName: row.project_peers?.display_name ?? "Unknown",
  }));

  let invitations: PendingInvitation[] = [];
  if (invitationsResponse) {
    if (!invitationsResponse.ok)
      throw new Error(await readError(invitationsResponse, "Invitations could not be loaded."));
    const invitationsBody = (await invitationsResponse.json()) as { data: InvitationApiRow[] };
    invitations = invitationsBody.data.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      expiresAt: row.expires_at,
    }));
  }
  return { members, invitations };
}

export function MembersPageClient({
  projectId,
  currentUserId,
  currentUserRole,
}: {
  projectId: string;
  currentUserId: string;
  currentUserRole: CallerRole;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const canManage = currentUserRole === "owner" || currentUserRole === "admin";

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const data = await fetchMembersAndInvitations(projectId, canManage);
      setMembers(data.members);
      setInvitations(data.invitations);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [projectId, canManage]);

  useEffect(() => {
    let active = true;
    fetchMembersAndInvitations(projectId, canManage)
      .then((data) => {
        if (!active) return;
        setMembers(data.members);
        setInvitations(data.invitations);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [projectId, canManage]);

  async function handleInvite(input: {
    email: string;
    role: "admin" | "member" | "viewer";
  }): Promise<{ acceptUrl: string }> {
    const response = await fetch(`/api/v1/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok)
      throw new Error(await readError(response, "The invitation could not be sent."));
    const body = (await response.json()) as { data: { acceptUrl: string } };
    await load();
    return { acceptUrl: body.data.acceptUrl };
  }

  async function handleRevoke(invitationId: string) {
    setMessage(null);
    const response = await fetch(`/api/v1/projects/${projectId}/invitations/${invitationId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setMessage(await readError(response, "The invitation could not be revoked."));
      return;
    }
    await load();
  }

  async function handleRoleChange(userId: string, role: "admin" | "member" | "viewer") {
    setMessage(null);
    const response = await fetch(`/api/v1/projects/${projectId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!response.ok) {
      setMessage(await readError(response, "The role could not be changed."));
      return;
    }
    await load();
  }

  async function handleRemove(userId: string) {
    setMessage(null);
    const response = await fetch(`/api/v1/projects/${projectId}/members/${userId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setMessage(await readError(response, "The member could not be removed."));
      return;
    }
    if (userId === currentUserId) {
      router.push("/projects");
      return;
    }
    await load();
  }

  if (status === "loading") {
    return <p className="text-muted-foreground mt-8 text-sm">Loading members…</p>;
  }
  if (status === "error") {
    return (
      <p role="alert" className="text-destructive mt-8 text-sm">
        Members could not be loaded. Refresh to try again.
      </p>
    );
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Members</h2>
        {canManage && <Button onClick={() => setInviteOpen(true)}>Invite</Button>}
      </div>
      {message && (
        <p role="status" className="text-muted-foreground mt-2 text-sm">
          {message}
        </p>
      )}
      <div className="mt-4">
        <MembersTable
          members={members}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          onRoleChange={(userId, role) => void handleRoleChange(userId, role)}
          onRemove={(userId) => void handleRemove(userId)}
        />
      </div>
      {canManage && (
        <PendingInvitations
          invitations={invitations}
          canManage={canManage}
          onRevoke={(id) => void handleRevoke(id)}
        />
      )}
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvite={handleInvite} />
    </div>
  );
}

"use client";
import { Button } from "@/components/ui/button";

export type PendingInvitation = { id: string; email: string; role: string; expiresAt: string };

export function PendingInvitations({
  invitations,
  canManage,
  onRevoke,
}: {
  invitations: PendingInvitation[];
  canManage: boolean;
  onRevoke: (id: string) => void;
}) {
  if (invitations.length === 0) return null;
  return (
    <div className="mt-6 space-y-2">
      <h3 className="text-muted-foreground text-sm font-medium">Pending invitations</h3>
      {invitations.map((invite) => (
        <div
          key={invite.id}
          className="flex items-center justify-between rounded border px-3 py-2 text-sm"
        >
          <span>
            {invite.email} · {invite.role}
          </span>
          {canManage && (
            <Button variant="ghost" size="sm" onClick={() => onRevoke(invite.id)}>
              Revoke
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

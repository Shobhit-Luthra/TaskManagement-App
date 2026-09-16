"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export type MemberRow = {
  userId: string;
  role: "owner" | "admin" | "member" | "viewer";
  displayName: string;
};
type CallerRole = "owner" | "admin" | "member" | "viewer";

const ROLE_OPTIONS = ["admin", "member", "viewer"] as const;

export function MembersTable({
  members,
  currentUserId,
  currentUserRole,
  onRoleChange,
  onRemove,
}: {
  members: MemberRow[];
  currentUserId: string;
  currentUserRole: CallerRole;
  onRoleChange: (userId: string, role: (typeof ROLE_OPTIONS)[number]) => void;
  onRemove: (userId: string) => void;
}) {
  const canManage = currentUserRole === "owner" || currentUserRole === "admin";
  const [pending, setPending] = useState<string | null>(null);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground text-left">
          <th className="pb-2 font-medium">Member</th>
          <th className="pb-2 font-medium">Role</th>
          {canManage && <th className="pb-2" />}
        </tr>
      </thead>
      <tbody>
        {members.map((member) => (
          <tr key={member.userId} className="border-t">
            <td className="py-2">{member.displayName}</td>
            <td className="py-2">
              {canManage && member.role !== "owner" ? (
                <select
                  value={member.role}
                  disabled={pending === member.userId}
                  onChange={(event) =>
                    onRoleChange(member.userId, event.target.value as (typeof ROLE_OPTIONS)[number])
                  }
                  className="bg-background rounded border px-2 py-1"
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              ) : canManage ? (
                <select disabled className="bg-background rounded border px-2 py-1 opacity-60">
                  <option>owner</option>
                </select>
              ) : (
                <span className="capitalize">{member.role}</span>
              )}
            </td>
            {canManage && (
              <td className="py-2 text-right">
                {member.role !== "owner" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending === member.userId}
                    onClick={() => {
                      setPending(member.userId);
                      onRemove(member.userId);
                    }}
                  >
                    {member.userId === currentUserId ? "Leave" : "Remove"}
                  </Button>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

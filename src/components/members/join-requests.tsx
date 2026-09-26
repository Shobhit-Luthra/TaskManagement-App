"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { JoinRole, PendingJoinRequest } from "@/lib/join-codes/schemas";

const ROLE_LABEL: Record<JoinRole, string> = { admin: "Admin", member: "Member", viewer: "Viewer" };

export function JoinRequests({
  requests,
  grantableRoles,
  onDecide,
}: {
  requests: PendingJoinRequest[];
  grantableRoles: JoinRole[];
  onDecide: (requestId: string, decision: "approve" | "deny", role?: JoinRole) => Promise<void>;
}) {
  // No default role: the approver has to choose one deliberately.
  const [roles, setRoles] = useState<Record<string, JoinRole | "">>({});
  const [busy, setBusy] = useState<string | null>(null);

  if (requests.length === 0) return null;

  async function decide(requestId: string, decision: "approve" | "deny") {
    setBusy(requestId);
    try {
      const role = roles[requestId];
      await onDecide(requestId, decision, decision === "approve" && role ? role : undefined);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-6 space-y-2" aria-labelledby="join-requests-heading">
      <h3 id="join-requests-heading" className="text-muted-foreground text-sm font-medium">
        Join requests ({requests.length})
      </h3>
      {requests.map((request) => {
        const role = roles[request.id] ?? "";
        const selectId = `join-role-${request.id}`;
        return (
          <div
            key={request.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded border px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{request.display_name}</p>
              <p className="text-muted-foreground truncate text-xs">
                {request.email} · asked {new Date(request.created_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor={selectId} className="sr-only">
                Role for {request.display_name}
              </label>
              <select
                id={selectId}
                value={role}
                onChange={(event) =>
                  setRoles((current) => ({
                    ...current,
                    [request.id]: event.target.value as JoinRole | "",
                  }))
                }
                className="bg-background rounded border px-2 py-1"
              >
                <option value="">Choose role</option>
                {grantableRoles.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABEL[option]}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={!role || busy === request.id}
                onClick={() => void decide(request.id, "approve")}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === request.id}
                onClick={() => void decide(request.id, "deny")}
              >
                Deny
              </Button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

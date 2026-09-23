"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export function InviteDialog({
  open,
  onOpenChange,
  onInvite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvite: (input: {
    email: string;
    role: "admin" | "member" | "viewer";
  }) => Promise<{ acceptUrl: string }>;
}) {
  const [email, setEmail] = useState(""),
    [role, setRole] = useState<"admin" | "member" | "viewer">("member"),
    [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState(false),
    [inviteLink, setInviteLink] = useState<string | null>(null),
    [copied, setCopied] = useState(false);

  function reset() {
    setEmail("");
    setError(null);
    setInviteLink(null);
    setCopied(false);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { acceptUrl } = await onInvite({ email, role });
      setInviteLink(acceptUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The invitation could not be sent.");
    } finally {
      setPending(false);
    }
  }

  async function copyLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogTitle>Invite someone</DialogTitle>
        {inviteLink ? (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Email delivery isn&apos;t set up yet, so share this link with {email} yourself — it
              works the same as an emailed invite.
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={inviteLink} onFocus={(event) => event.target.select()} />
              <Button type="button" onClick={() => void copyLink()}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                reset();
              }}
            >
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            <label className="block text-sm font-medium" htmlFor="invite-email">
              Email
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                maxLength={254}
                className="mt-2"
              />
            </label>
            <label className="block text-sm font-medium" htmlFor="invite-role">
              Role
              <select
                id="invite-role"
                value={role}
                onChange={(event) => setRole(event.target.value as typeof role)}
                className="bg-background mt-2 w-full rounded border px-3 py-2"
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" disabled={pending}>
              {pending ? "Sending" : "Send invite"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

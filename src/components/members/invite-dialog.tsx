"use client";
import { useState } from "react";
import * as Dialog from "radix-ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function InviteDialog({
  open,
  onOpenChange,
  onInvite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvite: (input: { email: string; role: "admin" | "member" | "viewer" }) => Promise<void>;
}) {
  const [email, setEmail] = useState(""),
    [role, setRole] = useState<"admin" | "member" | "viewer">("member"),
    [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await onInvite({ email, role });
      setEmail("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The invitation could not be sent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="bg-card fixed top-1/2 left-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5">
          <Dialog.Title className="text-lg font-semibold">Invite someone</Dialog.Title>
          <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-4">
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

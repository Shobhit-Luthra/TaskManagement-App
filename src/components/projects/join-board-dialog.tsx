"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { INVALID_CODE_MESSAGE, normalizeJoinCode } from "@/lib/join-codes/schemas";

function messageFor(status: number, serverMessage: string | undefined): string {
  if (status === 404 || status === 422) return INVALID_CODE_MESSAGE;
  if (status === 429) return "Too many attempts. Try again later.";
  return serverMessage ?? "Your request could not be sent.";
}

export function JoinBoardDialog({
  open,
  onOpenChange,
  onRequested,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequested?: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function reset() {
    setCode("");
    setError(null);
    setSentTo(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length !== 6 || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json().catch(() => null)) as {
        data?: { projectName: string };
        error?: { message?: string };
      } | null;
      if (!response.ok || !body?.data) {
        setError(messageFor(response.status, body?.error?.message));
        return;
      }
      setSentTo(body.data.projectName);
      onRequested?.();
    } catch {
      setError("Your request could not be sent. Check your connection and try again.");
    } finally {
      setPending(false);
    }
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
        <DialogHeader>
          <DialogTitle>Join a board</DialogTitle>
          <DialogDescription>
            Enter the 6-digit code a board admin gave you. They&apos;ll approve your request.
          </DialogDescription>
        </DialogHeader>
        {sentTo ? (
          <div className="space-y-4">
            <p role="status" className="text-sm">
              Request sent to <strong>{sentTo}</strong>. You&apos;ll get access when an admin
              approves it.
            </p>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            <label className="block text-sm font-medium" htmlFor="join-code">
              Code
              <Input
                id="join-code"
                value={code}
                onChange={(event) => setCode(normalizeJoinCode(event.target.value))}
                inputMode="numeric"
                autoComplete="one-time-code"
                // No maxLength: the browser would truncate a pasted "123 456"
                // before normalizeJoinCode strips the separator.
                pattern="[0-9]{6}"
                placeholder="000000"
                className="mt-2 font-mono text-2xl tracking-[0.4em] tabular-nums"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "join-code-error" : undefined}
              />
            </label>
            {error && (
              <p id="join-code-error" role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <Button type="submit" disabled={code.length !== 6 || pending}>
              {pending ? "Sending" : "Request to join"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

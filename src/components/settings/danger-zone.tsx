"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type BlockedProject = { projectId: string; projectName: string };

export class AccountDeleteError extends Error {
  blockedProjects: BlockedProject[];
  constructor(message: string, blockedProjects: BlockedProject[] = []) {
    super(message);
    this.blockedProjects = blockedProjects;
  }
}

function blockedProjectsOf(err: unknown): BlockedProject[] {
  const list = (err as { blockedProjects?: unknown })?.blockedProjects;
  return Array.isArray(list) ? (list as BlockedProject[]) : [];
}

export function DangerZone({
  onDelete,
  confirmationPhrase,
}: {
  onDelete: () => Promise<void>;
  confirmationPhrase: string;
}) {
  const [typed, setTyped] = useState(""),
    [error, setError] = useState<string | null>(null),
    [blocked, setBlocked] = useState<BlockedProject[]>([]),
    [pending, setPending] = useState(false);

  async function handleDelete() {
    setPending(true);
    setError(null);
    setBlocked([]);
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your account could not be deleted.");
      setBlocked(blockedProjectsOf(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="border-destructive/40 mt-8 space-y-4 rounded-xl border p-5">
      <h2 className="text-destructive text-sm font-semibold">Danger zone</h2>
      <p className="text-muted-foreground text-sm">
        Deleting your account anonymises your profile, removes you from every project and signs you
        out everywhere. This cannot be undone.
      </p>
      <label className="block text-sm font-medium" htmlFor="delete-confirm">
        Type &quot;{confirmationPhrase}&quot; to confirm
        <Input
          id="delete-confirm"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          className="mt-2"
        />
      </label>
      {error && (
        <div role="alert" className="text-destructive space-y-2 text-sm">
          <p>{error}</p>
          {blocked.length > 0 && (
            <ul className="list-inside list-disc">
              {blocked.map((project) => (
                <li key={project.projectId}>{project.projectName}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Button
        variant="destructive"
        disabled={typed !== confirmationPhrase || pending}
        onClick={() => void handleDelete()}
      >
        {pending ? "Deleting…" : "Delete account"}
      </Button>
    </section>
  );
}

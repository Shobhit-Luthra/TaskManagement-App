"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { isJoinCodeActive, type JoinCode } from "@/lib/join-codes/schemas";

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return body?.error?.message ?? fallback;
}

export function JoinCodePanel({ projectId }: { projectId: string }) {
  const [joinCode, setJoinCode] = useState<JoinCode | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const endpoint = `/api/v1/projects/${projectId}/join-code`;

  useEffect(() => {
    let active = true;
    fetch(endpoint)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const body = (await response.json()) as { data: JoinCode | null };
        if (active) {
          setJoinCode(body.data);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [endpoint]);

  async function generate() {
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch(endpoint, { method: "POST" });
      if (!response.ok)
        throw new Error(await readError(response, "The code could not be created."));
      const body = (await response.json()) as { data: JoinCode };
      setJoinCode(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The code could not be created.");
    } finally {
      setPending(false);
    }
  }

  async function turnOff() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok)
        throw new Error(await readError(response, "The code could not be turned off."));
      setJoinCode((current) =>
        current ? { ...current, disabled_at: new Date().toISOString() } : null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "The code could not be turned off.");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!joinCode) return;
    await navigator.clipboard.writeText(joinCode.code);
    setCopied(true);
  }

  if (status === "loading") return <p className="text-muted-foreground text-sm">Loading code…</p>;
  if (status === "error")
    return (
      <p role="alert" className="text-destructive text-sm">
        The join code could not be loaded.
      </p>
    );

  const active = isJoinCodeActive(joinCode);
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Anyone with this code can ask to join. They need your approval, and you choose their role
        when you approve.
      </p>
      {active && joinCode ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <span
              aria-label="Join code"
              className="font-mono text-3xl font-semibold tracking-[0.3em] tabular-nums"
            >
              {joinCode.code}
            </span>
            <Button type="button" variant="outline" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Expires {new Date(joinCode.expires_at).toLocaleString()}
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={() => void generate()} disabled={pending}>
              Regenerate
            </Button>
            <Button type="button" variant="ghost" onClick={() => void turnOff()} disabled={pending}>
              Turn off
            </Button>
          </div>
        </>
      ) : (
        <Button type="button" onClick={() => void generate()} disabled={pending}>
          {pending ? "Creating" : "Create join code"}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

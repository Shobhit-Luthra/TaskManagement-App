"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isCreatedProject(payload)) {
        setError("We couldn't create your project. Please try again.");
        return;
      }
      router.push(`/p/${payload.data.id}/board`);
      router.refresh();
    } catch {
      setError("Connection failed. Check your network and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-8 flex w-full max-w-md flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex-1 space-y-2">
        <Label htmlFor="project-name">Project name</Label>
        <Input
          id="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Website launch"
          maxLength={120}
          required
          disabled={pending}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create project"}
      </Button>
      {error && (
        <p className="text-destructive text-sm sm:col-span-2" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function isCreatedProject(value: unknown): value is { data: { id: string } } {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    typeof value.data === "object" &&
    value.data !== null &&
    "id" in value.data &&
    typeof value.data.id === "string"
  );
}

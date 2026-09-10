"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ProjectSettingsForm({
  project,
}: {
  project: { id: string; name: string; description: string | null; timezone: string };
}) {
  const [name, setName] = useState(project.name),
    [description, setDescription] = useState(project.description ?? ""),
    [timezone, setTimezone] = useState(project.timezone),
    [message, setMessage] = useState<string | null>(null),
    [pending, setPending] = useState(false);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || null, timezone }),
      });
      if (!response.ok) throw new Error();
      setMessage("Project settings saved.");
    } catch {
      setMessage("Settings could not be saved. Please try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      onSubmit={(event) => void save(event)}
      className="bg-card mt-8 space-y-5 rounded-xl border p-5"
    >
      <label className="block text-sm font-medium">
        Project name
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          className="mt-2"
          required
        />
      </label>
      <label className="block text-sm font-medium">
        Description
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={2000}
          rows={5}
          className="bg-background focus-visible:ring-ring/40 mt-2 w-full rounded-md border px-3 py-2 text-base font-normal outline-none focus-visible:ring-2"
        />
      </label>
      <label className="block text-sm font-medium">
        Timezone
        <Input
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          maxLength={64}
          className="mt-2"
          required
        />
      </label>
      {message && (
        <p role="status" className="text-muted-foreground text-sm">
          {message}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving" : "Save settings"}
      </Button>
    </form>
  );
}

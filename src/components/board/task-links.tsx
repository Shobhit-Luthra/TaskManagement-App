"use client";

import { useEffect, useState } from "react";
import { Link2, LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createTaskLinkSchema, linkHostname, type TaskLink } from "@/lib/links/schemas";

export function TaskLinks({
  taskId,
  currentUserId,
  currentUserRole,
  readOnly,
  onCountChange,
}: {
  taskId: string;
  currentUserId: string;
  currentUserRole: "owner" | "admin" | "member" | "viewer";
  readOnly: boolean;
  onCountChange?: (count: number) => void;
}) {
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/tasks/${taskId}/links`)
      .then(async (response) => {
        const payload = (await response.json()) as { data?: unknown };
        if (!response.ok || !Array.isArray(payload.data)) throw new Error("Load rejected");
        if (active) setLinks(payload.data as TaskLink[]);
      })
      .catch(() => active && setError("Links could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [taskId]);

  function commit(next: TaskLink[]) {
    setLinks(next);
    onCountChange?.(next.length);
  }

  async function addLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createTaskLinkSchema.safeParse({ url, title: title.trim() || null });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the link and try again.");
      return;
    }
    setError(null);
    setPendingId("new");
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const payload = (await response.json()) as {
        data?: TaskLink;
        error?: { message?: string };
      };
      if (!response.ok || !payload.data)
        throw new Error(payload.error?.message ?? "Link could not be added. Try again.");
      commit([...links, payload.data]);
      setUrl("");
      setTitle("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Link could not be added. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  async function removeLink(link: TaskLink) {
    setError(null);
    setPendingId(link.id);
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/links/${link.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Delete rejected");
      commit(links.filter((item) => item.id !== link.id));
    } catch {
      setError("Link could not be removed. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  const canManageAll = currentUserRole === "owner" || currentUserRole === "admin";
  return (
    <section className="space-y-3 border-t pt-5" aria-labelledby="links-title">
      <h3 id="links-title" className="font-medium">
        Links
      </h3>
      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" /> Loading links
        </div>
      ) : (
        <ul aria-label="Links" className="space-y-1.5">
          {links.map((link) => {
            const label = link.title ?? linkHostname(link.url);
            const canRemove = !readOnly && (canManageAll || link.created_by === currentUserId);
            return (
              <li
                key={link.id}
                className="hover:bg-muted/60 flex items-center gap-2 rounded-md px-1 py-1.5"
              >
                <Link2 className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-visible:ring-ring min-w-0 flex-1 rounded text-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="block truncate font-medium">{label}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {linkHostname(link.url)}
                  </span>
                </a>
                {canRemove && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${label}`}
                    disabled={pendingId === link.id}
                    onClick={() => void removeLink(link)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!loading && links.length === 0 && (
        <p className="text-muted-foreground text-sm">Add links to docs, designs or tickets.</p>
      )}
      {!readOnly && (
        <form
          className="grid gap-2 sm:grid-cols-[1fr_12rem_auto]"
          onSubmit={(e) => void addLink(e)}
        >
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            type="text"
            inputMode="url"
            maxLength={2048}
            placeholder="https://"
            aria-label="Link URL"
            className="bg-background placeholder:text-muted-foreground focus-visible:ring-ring/40 h-9 min-w-0 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
          />
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            placeholder="Title (optional)"
            aria-label="Link title (optional)"
            className="bg-background placeholder:text-muted-foreground focus-visible:ring-ring/40 h-9 min-w-0 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
          />
          <Button type="submit" size="sm" disabled={!url.trim() || pendingId === "new"}>
            {pendingId === "new" ? "Adding" : "Add link"}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </section>
  );
}

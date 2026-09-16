"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FolderKanban, RotateCcw } from "lucide-react";
import { CreateProjectForm } from "@/components/projects/create-project-form";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type Project = {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
  role: "owner" | "admin" | "member" | "viewer";
};
type Status = "loading" | "ready" | "error";

async function fetchProjects() {
  const client = createClient();
  const [{ data, error }, { data: membershipData, error: membershipError }] = await Promise.race([
    Promise.all([
      client
        .from("projects")
        .select("id, name, description, updated_at")
        .is("deleted_at", null)
        .eq("is_archived", false)
        .order("updated_at", { ascending: false }),
      client.from("memberships").select("project_id, role"),
    ]),
    new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error("Projects request timed out")), 5_000),
    ),
  ]);
  if (error) throw error;
  if (membershipError) throw membershipError;
  const roleByProjectId = new Map(
    (membershipData ?? []).map((row) => [row.project_id as string, row.role as Project["role"]]),
  );
  return ((data ?? []) as Omit<Project, "role">[]).map((project) => ({
    ...project,
    role: roleByProjectId.get(project.id) ?? "viewer",
  }));
}

async function leaveProject(projectId: string, userId: string): Promise<void> {
  const response = await fetch(`/api/v1/projects/${projectId}/members/${userId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("The project could not be left.");
}

export function ProjectsWorkspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const load = useCallback(() => {
    setStatus("loading");
    void fetchProjects()
      .then((data) => {
        setProjects(data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);
  useEffect(() => {
    let active = true;
    void fetchProjects()
      .then((data) => {
        if (active) {
          setProjects(data);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (active) setCurrentUserId(data.user?.id ?? null);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleLeave(projectId: string) {
    if (!currentUserId) return;
    setLeavingId(projectId);
    try {
      await leaveProject(projectId, currentUserId);
      load();
    } catch {
      setLeavingId(null);
    }
  }
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">Your projects</h1>
        <p className="text-muted-foreground mt-2">
          Create a shared workspace, then move work from idea to done.
        </p>
      </div>
      {status === "loading" ? (
        <p className="text-muted-foreground mt-8 text-sm">Loading projects…</p>
      ) : status === "error" ? (
        <section className="mt-10 max-w-xl rounded-xl border p-6">
          <h2 className="font-semibold">Your projects are unavailable</h2>
          <p role="alert" className="text-muted-foreground mt-2 text-sm">
            Projects could not be loaded. Check your connection and try again.
          </p>
          <Button type="button" variant="outline" className="mt-5" onClick={load}>
            <RotateCcw /> Try again
          </Button>
        </section>
      ) : projects.length === 0 ? (
        <section className="mt-12 border-y py-12">
          <FolderKanban className="text-muted-foreground size-8" aria-hidden="true" />
          <h2 className="mt-5 text-xl font-semibold">Create your first project</h2>
          <p className="text-muted-foreground mt-2 max-w-xl">
            Start with a name. Kanbo creates your first workflow so your team can add work straight
            away.
          </p>
          <CreateProjectForm />
        </section>
      ) : (
        <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="hover:bg-accent rounded-xl border p-5 transition-colors"
            >
              <Link
                href={`/p/${project.id}/board`}
                className="focus-visible:ring-ring block rounded-md focus-visible:ring-2 focus-visible:outline-none"
              >
                <FolderKanban className="text-muted-foreground size-5" aria-hidden="true" />
                <h2 className="mt-6 font-semibold">{project.name}</h2>
                <p className="text-muted-foreground mt-1 line-clamp-2 min-h-10 text-sm">
                  {project.description || "No description yet."}
                </p>
                <p className="text-muted-foreground mt-5 text-xs">
                  Updated{" "}
                  {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                    new Date(project.updated_at),
                  )}
                </p>
              </Link>
              {project.role !== "owner" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-3 -ml-2"
                  disabled={leavingId === project.id}
                  onClick={() => void handleLeave(project.id)}
                >
                  {leavingId === project.id ? "Leaving…" : "Leave"}
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

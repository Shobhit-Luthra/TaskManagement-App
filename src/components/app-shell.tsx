"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CheckCircle2, FolderKanban, UserCircle } from "lucide-react";
import { Brand } from "@/components/brand";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notifications/bell";
import { createClient } from "@/lib/supabase/client";

type SidebarProject = { id: string; name: string };

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [accountError, setAccountError] = useState(false);
  const [projects, setProjects] = useState<SidebarProject[]>([]);
  useEffect(() => {
    let active = true;
    void createClient()
      .from("projects")
      .select("id, name")
      .is("deleted_at", null)
      .eq("is_archived", false)
      .order("updated_at", { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (active && data) setProjects(data);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.race([
      createClient().auth.getUser(),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error("Account request timed out")), 5_000),
      ),
    ])
      .then(({ data }) => {
        if (!active) return;
        if (!data.user) {
          router.replace("/login");
          return;
        }
        if (!data.user.email_confirmed_at) {
          router.replace("/verify-email");
          return;
        }
        setEmail(data.user.email ?? "Signed in");
        setUserId(data.user.id);
      })
      .catch(() => {
        if (active) setAccountError(true);
      });
    return () => {
      active = false;
    };
  }, [router]);
  return (
    <div className="min-h-dvh">
      <a
        href="#workspace-content"
        className="bg-popover sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:p-3"
      >
        Skip to content
      </a>
      <header className="bg-background flex h-20 items-center justify-between gap-4 border-b px-4 sm:px-7">
        <Link
          href="/projects"
          aria-label="Kanbo projects"
          className="focus-visible:outline-ring shrink-0 rounded-md focus-visible:outline-2"
        >
          <Brand className="w-32" />
        </Link>
        <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm sm:gap-4">
          {userId && <NotificationBell userId={userId} />}
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger
              className="focus-visible:outline-ring rounded-full focus-visible:outline-2"
              aria-label="Account menu"
            >
              <Avatar size="lg">
                <AvatarFallback className="bg-secondary text-secondary-foreground font-semibold">
                  {email?.slice(0, 2).toUpperCase() ?? <UserCircle className="size-5" />}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="break-all">
                {email ?? (accountError ? "Account unavailable" : "Loading account…")}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/account">
                  <UserCircle />
                  Account settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="p-2">
                <SignOutButton />
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="flex min-h-[calc(100dvh-5rem)] flex-col lg:flex-row">
        <aside className="bg-surface-high border-b lg:w-56 lg:shrink-0 lg:border-r lg:border-b-0">
          <nav
            aria-label="Workspace"
            className="flex gap-2 p-3 lg:sticky lg:top-0 lg:flex-col lg:p-5"
          >
            {[
              {
                href: "/projects",
                label: "Projects",
                icon: FolderKanban,
                active: pathname === "/projects" || pathname.startsWith("/p/"),
              },
              {
                href: "/my-tasks",
                label: "My Tasks",
                icon: CheckCircle2,
                active: pathname === "/my-tasks",
              },
            ].map(({ href, label, icon: Icon, active }) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname === href ? "page" : undefined}
                className={cn(
                  "hover:bg-background/60 focus-visible:outline-ring flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium focus-visible:outline-2",
                  active ? "bg-background text-brand-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </Link>
            ))}
            {projects.length > 0 && (
              <div className="mt-2 hidden lg:block">
                <p className="text-muted-foreground px-3 text-xs font-semibold tracking-wide uppercase">
                  Your projects
                </p>
                <ul className="mt-2 space-y-1">
                  {projects.map((project) => {
                    const href = `/p/${project.id}/board`;
                    const active = pathname.startsWith(`/p/${project.id}`);
                    return (
                      <li key={project.id}>
                        <Link
                          href={href}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "hover:bg-background/60 focus-visible:outline-ring block truncate rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-2",
                            active ? "bg-background text-brand-primary" : "text-muted-foreground",
                          )}
                        >
                          {project.name}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </nav>
        </aside>
        <div id="workspace-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          {children}
        </div>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Activity,
  BarChart3,
  Calendar,
  CalendarDays,
  CheckCircle2,
  LayoutGrid,
  List,
  Settings,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function ProjectNav({ projectId, role }: { projectId: string; role: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const base = `/p/${projectId}`;
  const links = [
    { label: "Board", href: `${base}/board`, icon: LayoutGrid, filters: true },
    { label: "List", href: `${base}/list`, icon: List, filters: true },
    { label: "Timeline", href: `${base}/timeline`, icon: Calendar, filters: false },
    { label: "Calendar", href: `${base}/calendar`, icon: CalendarDays, filters: false },
    { label: "My Tasks", href: "/my-tasks", icon: CheckCircle2, filters: false },
    { label: "Activity", href: `${base}/activity`, icon: Activity, filters: false },
    { label: "Analytics", href: `${base}/analytics`, icon: BarChart3, filters: false },
    ...(["owner", "admin"].includes(role)
      ? [{ label: "Settings", href: `${base}/settings`, icon: Settings, filters: false }]
      : []),
    ...(role !== "viewer"
      ? [{ label: "Trash", href: `${base}/trash`, icon: Trash2, filters: false }]
      : []),
  ];
  const params = new URLSearchParams(search.toString());
  params.delete("task");
  return (
    <nav
      aria-label="Project views"
      className="bg-background flex overflow-x-auto border-b px-4 sm:px-7"
    >
      {links.map(({ label, href, icon: Icon, filters }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={filters && params.size ? `${href}?${params}` : href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "hover:text-brand-primary focus-visible:outline-ring flex shrink-0 items-center gap-2 border-b-2 border-transparent px-4 py-4 text-sm font-medium transition-colors focus-visible:outline-2",
              active ? "border-brand-primary text-brand-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

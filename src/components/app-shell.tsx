"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notifications/bell";
import { createClient } from "@/lib/supabase/client";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [accountError, setAccountError] = useState(false);
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
      <header className="mx-auto flex max-w-6xl items-center justify-between p-6">
        <Link href="/projects" className="hover:text-muted-foreground font-semibold tracking-tight">
          Kanbo
        </Link>
        <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm sm:gap-4">
          <Link href="/my-tasks" className="hover:text-foreground shrink-0 font-medium">
            My Tasks
          </Link>
          {email ? (
            <Link href="/account" className="hover:text-foreground max-w-36 truncate sm:max-w-64">
              {email}
            </Link>
          ) : (
            <span className="max-w-36 truncate sm:max-w-64">
              {accountError ? "Account unavailable" : "Loading account…"}
            </span>
          )}
          {userId && <NotificationBell userId={userId} />}
          <ThemeToggle />
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { AccountDeleteError, DangerZone, type BlockedProject } from "./danger-zone";

const CONFIRMATION_PHRASE = "delete my account";

export function DeleteAccount() {
  const router = useRouter();

  async function deleteAccount() {
    const response = await fetch("/api/v1/users/me", { method: "DELETE" });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string; details?: { blockedProjects?: BlockedProject[] } };
      } | null;
      throw new AccountDeleteError(
        payload?.error?.message ?? "Your account could not be deleted. Please try again.",
        payload?.error?.details?.blockedProjects ?? [],
      );
    }
    router.replace("/login");
    router.refresh();
  }

  return <DangerZone onDelete={deleteAccount} confirmationPhrase={CONFIRMATION_PHRASE} />;
}

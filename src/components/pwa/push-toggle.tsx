"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";

type State = "loading" | "unsupported" | "unconfigured" | "blocked" | "off" | "on";

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

const HINTS: Partial<Record<State, string>> = {
  unsupported:
    "This browser doesn't support push notifications. On iPhone, add Kanbo to your Home Screen first.",
  unconfigured: "Push notifications aren't set up on this server yet.",
  blocked: "Notifications are blocked for this site. Allow them in your browser settings.",
};

export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function detect(): Promise<State> {
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      )
        return "unsupported";
      if (!PUBLIC_KEY) return "unconfigured";
      if (Notification.permission === "denied") return "blocked";
      const registration = await navigator.serviceWorker.getRegistration();
      const existing = await registration?.pushManager.getSubscription();
      return existing ? "on" : "off";
    }
    void detect()
      .then((next) => active && setState(next))
      .catch(() => active && setState("unsupported"));
    return () => {
      active = false;
    };
  }, []);

  async function enable() {
    if (!PUBLIC_KEY) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY),
        }));
      const response = await fetch("/api/v1/push/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) {
        await subscription.unsubscribe();
        throw new Error("Server rejected the subscription");
      }
      setState("on");
    } catch {
      setError("Notifications could not be enabled on this device.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/v1/push/subscription", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setError("Notifications could not be turned off. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-card mt-6 rounded-xl border p-5 text-sm" aria-labelledby="push-title">
      <h2 id="push-title" className="font-medium">
        Push notifications
      </h2>
      <p className="text-muted-foreground mt-1">
        Get assignments, mentions and due-soon reminders on this device, even when Kanbo is closed.
      </p>
      {HINTS[state] && <p className="text-muted-foreground mt-3">{HINTS[state]}</p>}
      {(state === "off" || state === "on") && (
        <Button
          type="button"
          size="sm"
          variant={state === "on" ? "outline" : "default"}
          className="mt-3"
          disabled={busy}
          onClick={() => void (state === "on" ? disable() : enable())}
        >
          {state === "on" ? <BellOff className="size-4" /> : <Bell className="size-4" />}
          {state === "on" ? "Turn off on this device" : "Turn on for this device"}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-destructive mt-3">
          {error}
        </p>
      )}
    </section>
  );
}

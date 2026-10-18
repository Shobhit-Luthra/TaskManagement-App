import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { describe, type NotificationRow } from "@/lib/notifications/flush";
import { getVapidConfig } from "@/lib/push/config";
import { log } from "@/lib/log";

type PendingNotification = NotificationRow & {
  user_id: string;
  project_id: string;
  task_id: string | null;
};
type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

// Older than this and a push is noise (the user has long since seen it in the app).
const MAX_AGE_MS = 60 * 60_000;
const BATCH = 200;

/**
 * Sends a web push for each recent notification that has not been offered to push yet, to
 * every device its recipient subscribed. Dead subscriptions (404/410) are pruned. A
 * notification is marked handled even when the user has no devices, so the table cannot grow
 * an ever-longer pending scan.
 */
export async function flushPushQueue(): Promise<{
  sent: number;
  pruned: number;
  skipped?: string;
}> {
  const vapid = getVapidConfig();
  if (!vapid) return { sent: 0, pruned: 0, skipped: "VAPID keys not configured" };
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  const admin = createAdminClient();
  const since = new Date(Date.now() - MAX_AGE_MS).toISOString();
  const { data: pending, error } = await admin
    .from("notifications")
    .select("id, type, payload, user_id, project_id, task_id")
    .is("push_sent_at", null)
    .gte("created_at", since)
    .order("created_at")
    .limit(BATCH);
  if (error) throw error;
  const items = (pending ?? []) as PendingNotification[];
  if (items.length === 0) return { sent: 0, pruned: 0 };

  const userIds = [...new Set(items.map((item) => item.user_id))];
  const { data: subs, error: subsError } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  if (subsError) throw subsError;
  const byUser = new Map<string, Subscription[]>();
  for (const sub of (subs ?? []) as Subscription[]) {
    byUser.set(sub.user_id, [...(byUser.get(sub.user_id) ?? []), sub]);
  }

  let sent = 0;
  const dead = new Set<string>();
  for (const item of items) {
    const body = JSON.stringify({
      title: "Kanbo",
      body: describe(item),
      url: item.task_id ? `/p/${item.project_id}/board?task=${item.task_id}` : "/my-tasks",
      tag: item.id,
    });
    for (const sub of byUser.get(item.user_id) ?? []) {
      if (dead.has(sub.id)) continue;
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: 3600, urgency: "normal" },
        );
        sent++;
      } catch (caught) {
        const status = (caught as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.add(sub.id);
        else log("warn", "push.send_failed", { status: status ?? 0 });
      }
    }
  }

  if (dead.size > 0)
    await admin
      .from("push_subscriptions")
      .delete()
      .in("id", [...dead]);
  await admin
    .from("notifications")
    .update({ push_sent_at: new Date().toISOString() })
    .in(
      "id",
      items.map((item) => item.id),
    );
  return { sent, pruned: dead.size };
}

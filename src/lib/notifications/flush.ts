import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailSender } from "@/lib/email";
import { log } from "@/lib/log";

const MAX_ATTEMPTS = 6;

type QueueRow = {
  id: string;
  user_id: string;
  window_start: string;
  attempts: number;
};

type NotificationRow = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}

function describe(n: NotificationRow): string {
  const title = String(n.payload.taskTitle ?? "a task");
  switch (n.type) {
    case "task_assigned":
      return `You were assigned "${title}"`;
    case "task_unassigned":
      return `You were unassigned from "${title}"`;
    case "mentioned":
      return `You were mentioned on "${title}"`;
    case "status_changed":
      return `"${title}" moved to ${String(n.payload.toColumn ?? "a new column")}`;
    case "due_soon":
      return `"${title}" is due soon`;
    default:
      return title;
  }
}

/**
 * Sends one batched email per due notification_queue row (one row per user
 * per 5-minute window, per enqueue_notifications). On failure, backs off
 * exponentially (send_after += 2^attempts minutes) up to MAX_ATTEMPTS, after
 * which the row is left dead (attempts exhausted, no further retry) and
 * logged.
 */
export async function flushNotificationQueue(): Promise<{ sent: number; failed: number }> {
  const admin = createAdminClient();
  const sender = getEmailSender();
  const now = new Date();

  const { data: dueRows, error: queueError } = await admin
    .from("notification_queue")
    .select("id, user_id, window_start, attempts")
    .is("sent_at", null)
    .lte("send_after", now.toISOString())
    .lt("attempts", MAX_ATTEMPTS);
  if (queueError) throw queueError;
  const rows = (dueRows ?? []) as QueueRow[];

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const { data: user, error: userError } = await admin
        .from("users")
        .select("email, display_name, email_undeliverable_at")
        .eq("id", row.user_id)
        .single();
      if (userError) throw userError;
      if (!user || user.email_undeliverable_at) {
        await admin
          .from("notification_queue")
          .update({ sent_at: now.toISOString() })
          .eq("id", row.id);
        continue;
      }

      const { data: notifications, error: notificationsError } = await admin
        .from("notifications")
        .select("id, type, payload")
        .eq("user_id", row.user_id)
        .eq("email_status", "pending")
        .gte("created_at", row.window_start)
        .lt(
          "created_at",
          new Date(new Date(row.window_start).getTime() + 5 * 60_000).toISOString(),
        );
      const items = (notifications ?? []) as NotificationRow[];
      if (notificationsError) throw notificationsError;

      const lines = items.map((n) => `• ${describe(n)}`);
      const text = `Hi ${user.display_name},\n\n${lines.join("\n") || "You have a new notification."}`;
      const html = `<p>Hi ${escapeHtml(user.display_name)},</p><ul>${items.map((item) => `<li>${escapeHtml(describe(item))}</li>`).join("")}</ul>`;

      await sender.send({
        to: user.email,
        subject: items.length > 1 ? `${items.length} updates in Kanbo` : "An update in Kanbo",
        text,
        html,
        category: "notification",
      });

      if (items.length > 0) {
        const { error } = await admin
          .from("notifications")
          .update({ email_status: "sent" })
          .in(
            "id",
            items.map((item) => item.id),
          );
        if (error) throw error;
      }
      const { error: sentError } = await admin
        .from("notification_queue")
        .update({ sent_at: now.toISOString() })
        .eq("id", row.id);
      if (sentError) throw sentError;
      sent++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextAttempts = row.attempts + 1;
      const backoffMinutes = 2 ** nextAttempts;
      await admin
        .from("notification_queue")
        .update({
          attempts: nextAttempts,
          last_error: message,
          send_after: new Date(now.getTime() + backoffMinutes * 60_000).toISOString(),
        })
        .eq("id", row.id);
      log("error", "notifications.flush_failed", { userId: row.user_id, attempts: nextAttempts });
      failed++;
    }
  }

  return { sent, failed };
}

import { randomUUID } from "node:crypto";
import type { EmailMessage, EmailSender } from "./sender";
import { log } from "@/lib/log";

export class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<{ id: string }> {
    const id = randomUUID();
    log("info", "email.sent", {
      id,
      to: message.to,
      subject: message.subject,
      category: message.category,
    });
    return { id };
  }
}

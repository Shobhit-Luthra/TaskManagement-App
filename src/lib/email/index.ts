import type { EmailSender } from "./sender";
import { ConsoleEmailSender } from "./console-sender";

export function getEmailSender(): EmailSender {
  const provider = process.env.EMAIL_PROVIDER ?? "console";
  if (provider === "console") return new ConsoleEmailSender();
  throw new Error(
    `Unknown EMAIL_PROVIDER "${provider}" — only "console" is wired up until 2F.7 (Resend).`,
  );
}

export type { EmailCategory, EmailMessage, EmailSender } from "./sender";

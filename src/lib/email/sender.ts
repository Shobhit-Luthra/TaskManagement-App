export type EmailCategory = "transactional" | "notification" | "digest";
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  category: EmailCategory;
};
export interface EmailSender {
  send(message: EmailMessage): Promise<{ id: string }>;
}

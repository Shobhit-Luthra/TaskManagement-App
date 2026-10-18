import { Paperclip } from "lucide-react";

export function AttachmentCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <Paperclip className="size-3" aria-hidden="true" />
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">
        {count} {count === 1 ? "attachment" : "attachments"}
      </span>
    </span>
  );
}

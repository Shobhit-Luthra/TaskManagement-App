import { ListChecks } from "lucide-react";

export function SubtaskProgress({ done, total }: { done: number; total: number }) {
  if (total === 0) return null;
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <ListChecks className="size-3" aria-hidden="true" />
      <span aria-hidden="true">
        {done}/{total}
      </span>
      <span className="sr-only">
        {done} of {total} subtasks complete
      </span>
    </span>
  );
}

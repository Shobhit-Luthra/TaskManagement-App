import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center p-6 text-center">
      <div className="bg-muted rounded-xl p-4">
        <SearchX className="text-muted-foreground size-8" aria-hidden="true" />
      </div>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">That page is not here</h1>
      <p className="text-muted-foreground mt-3">
        It may have moved, been deleted, or the link may be incomplete.
      </p>
      <Link
        href="/projects"
        className="bg-primary text-primary-foreground hover:bg-primary/90 mt-7 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium"
      >
        <ArrowLeft className="size-4" /> Back to projects
      </Link>
    </main>
  );
}

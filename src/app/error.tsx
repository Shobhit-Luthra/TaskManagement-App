"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

export default function ErrorPage({
  reset,
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center p-6 text-center">
      <div className="bg-destructive/10 rounded-xl p-4">
        <AlertTriangle className="text-destructive size-8" aria-hidden="true" />
      </div>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">We couldn’t load that page</h1>
      <p className="text-muted-foreground mt-3">
        Try again. If the problem continues, return to your projects and try once more later.
      </p>
      {error.digest && (
        <p className="text-muted-foreground mt-2 text-sm">Reference: {error.digest}</p>
      )}
      <button
        type="button"
        onClick={reset}
        className="bg-primary text-primary-foreground hover:bg-primary/90 mt-7 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium"
      >
        <RotateCcw className="size-4" /> Try again
      </button>
    </main>
  );
}

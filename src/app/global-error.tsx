"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center p-6">
        <div className="space-y-3 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          {error.digest && (
            <p className="text-muted-foreground text-sm">Reference: {error.digest}</p>
          )}
          <button type="button" onClick={reset} className="underline">
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

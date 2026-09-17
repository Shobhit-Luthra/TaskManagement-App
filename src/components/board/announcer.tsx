"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";

export type AnnouncerHandle = { announce: (message: string) => void };

export const Announcer = forwardRef<AnnouncerHandle>(function Announcer(_props, ref) {
  const [message, setMessage] = useState("");
  const lastAnnouncedAt = useRef(0);

  useImperativeHandle(ref, () => ({
    announce(next: string) {
      const now = Date.now();
      if (now - lastAnnouncedAt.current < 1000) return;
      lastAnnouncedAt.current = now;
      setMessage(next);
    },
  }));

  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
});

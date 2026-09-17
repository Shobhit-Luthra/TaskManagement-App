"use client";

import { useEffect } from "react";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable="true"], [role="dialog"], [role="alertdialog"]'))
  );
}

export function useBoardShortcuts(handlers: {
  onFocusSearch: () => void;
  onToggleFilters: () => void;
  onNewTask: () => void;
  onShowHelp: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        isTypingTarget(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        handlers.onFocusSearch();
      } else if (event.key === "f" || event.key === "F") handlers.onToggleFilters();
      else if (event.key === "n" || event.key === "N") handlers.onNewTask();
      else if (event.key === "?") handlers.onShowHelp();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}

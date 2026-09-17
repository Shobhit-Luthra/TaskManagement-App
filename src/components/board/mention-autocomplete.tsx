"use client";

import { useMemo, useState } from "react";

export type PeerOption = { userId: string; displayName: string };

export function MentionAutocomplete({
  peers,
  textareaId,
  value,
  onChange,
  ariaLabel = "Add a comment",
}: {
  peers: PeerOption[];
  textareaId: string;
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(true);
  const trigger = useMemo(() => {
    const match = /(?:^|\s)@([\w' -]{0,40})$/.exec(value);
    return match
      ? {
          prefix: match[1]!.toLowerCase(),
          start: match.index + (match[0]!.startsWith(" ") ? 1 : 0),
        }
      : null;
  }, [value]);
  const suggestions =
    open && trigger
      ? peers.filter((peer) => peer.displayName.toLowerCase().includes(trigger.prefix)).slice(0, 5)
      : [];

  function select(peer: PeerOption) {
    if (!trigger) return;
    onChange(`${value.slice(0, trigger.start)}@[${peer.displayName}](${peer.userId}) `);
    setOpen(false);
  }

  return (
    <div className="relative">
      <textarea
        id={textareaId}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        maxLength={5000}
        rows={3}
        className="bg-background focus-visible:ring-ring/40 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
      />
      {suggestions.length > 0 && (
        <ul
          role="listbox"
          className="bg-card absolute z-10 mt-1 w-full rounded-md border shadow-md"
        >
          {suggestions.map((peer) => (
            <li key={peer.userId}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="hover:bg-muted w-full px-3 py-1.5 text-left text-sm"
                onClick={() => select(peer)}
              >
                {peer.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

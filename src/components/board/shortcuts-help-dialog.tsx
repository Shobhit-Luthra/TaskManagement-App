"use client";

import * as Dialog from "radix-ui/dialog";
import { Button } from "@/components/ui/button";

export function ShortcutsHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="ghost" size="sm">
          Keyboard shortcuts
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="bg-card fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5">
          <Dialog.Title className="text-lg font-semibold">Keyboard shortcuts</Dialog.Title>
          <Dialog.Description className="text-muted-foreground mt-2 text-sm">
            Available on the board when you are not typing in a field.
          </Dialog.Description>
          <dl className="my-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
            <dt>
              <kbd>/</kbd>
            </dt>
            <dd>Focus search</dd>
            <dt>
              <kbd>F</kbd>
            </dt>
            <dd>Show or hide filters</dd>
            <dt>
              <kbd>N</kbd>
            </dt>
            <dd>New task in the current column</dd>
            <dt>
              <kbd>?</kbd>
            </dt>
            <dd>Show keyboard shortcuts</dd>
          </dl>
          <Dialog.Close asChild>
            <Button type="button" variant="outline">
              Close
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

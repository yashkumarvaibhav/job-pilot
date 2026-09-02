"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import type { QuickAddAction } from "./quick-add";

const CommandPalette = dynamic(() => import("./command-palette"), {
  ssr: false,
});

export function CommandPaletteHost({
  onQuickAdd,
}: {
  onQuickAdd: (action: QuickAddAction, trigger: HTMLElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);

  const openPalette = useCallback((from: HTMLElement | null) => {
    setTrigger(from);
    setLoaded(true);
    setOpen(true);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      const from =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setTrigger(from);
      setLoaded(true);
      setOpen((current) => !current);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K Meta+K"
        aria-label="Open command palette"
        className="palette-trigger"
        onClick={(event) => openPalette(event.currentTarget)}
        type="button"
      >
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </button>
      {loaded ? (
        <CommandPalette
          onOpenChange={setOpen}
          onQuickAdd={(action) => {
            setOpen(false);
            onQuickAdd(action, trigger);
          }}
          open={open}
          returnFocusTo={trigger}
        />
      ) : null}
    </>
  );
}

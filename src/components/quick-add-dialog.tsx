"use client";

import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type Focusable = Pick<HTMLElement, "focus">;

type FocusContainer = {
  querySelectorAll: (selector: string) => ArrayLike<Focusable>;
};

type TabKey = Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">;

export function trapDialogTab(
  container: FocusContainer,
  event: TabKey,
  activeElement: unknown,
) {
  if (event.key !== "Tab") return;

  const focusable = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable.at(-1)!;
  if (event.shiftKey && (activeElement === first || !focusable.includes(activeElement as Focusable))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (activeElement === last || !focusable.includes(activeElement as Focusable))) {
    event.preventDefault();
    first.focus();
  }
}

export function QuickAddDialog({
  children,
  onClose,
  returnFocusTo,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
  title: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      const first =
        dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]") ??
        dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      first?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      trapDialogTab(dialog!, event, document.activeElement);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => returnFocusTo?.focus());
    };
  }, [onClose, returnFocusTo]);

  return (
    <div
      className="quick-add-backdrop"
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-labelledby="quick-add-title"
        aria-modal="true"
        className="quick-add-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <span aria-hidden="true" className="quick-add-grabber" />
        <header className="quick-add-header">
          <div>
            <p className="eyebrow">Quick add</p>
            <h2 id="quick-add-title">{title}</h2>
          </div>
          <button
            aria-label="Close quick add"
            className="quick-add-close"
            onClick={onClose}
            type="button"
          >
            <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className="quick-add-content">{children}</div>
      </section>
    </div>
  );
}

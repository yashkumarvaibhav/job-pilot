"use client";
import { ExternalLink, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { trapDialogTab } from "./quick-add-dialog";
export function PreviewDialog({ kind, title, href, onClose, opener, children }: {
  kind: string;
  title: string;
  href: string;
  onClose: () => void;
  opener: HTMLElement | null;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog)
      return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      dialog
        .querySelector<HTMLElement>("[data-dialog-initial-focus]")
        ?.focus();
    });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" || event.key === "Tab")
        event.stopImmediatePropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      trapDialogTab(dialog!, event, document.activeElement);
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => opener?.focus());
    };
  }, [onClose, opener]);
  return (<div className="contact-preview-backdrop" onPointerDown={(event) => {
      if (event.currentTarget === event.target)
        onClose();
    }}>
      <section aria-labelledby="contact-preview-title" aria-modal="true" className="contact-preview-dialog" data-density="compact" ref={dialogRef} role="dialog">
    <header className="contact-preview-header">
          <div>
      <p className="eyebrow">{kind[0].toUpperCase() + kind.slice(1)} preview</p>
      <h2 id="contact-preview-title">{title}</h2>
          </div>
          <button aria-label={`Close ${kind} preview`} className="contact-preview-close" data-dialog-initial-focus onClick={onClose} type="button">
      <X aria-hidden="true"/>
          </button>
    </header>

    <div aria-live="polite" className="contact-preview-content">
          {children}
    </div>

    <footer className="contact-preview-actions">
          <a className="btn" href={href} rel="noopener noreferrer" target="_blank">
      Open {kind} in new tab
      <ExternalLink aria-hidden="true"/>
          </a>
          <button className="btn btn--ghost" onClick={onClose} type="button">
      Close
          </button>
    </footer>
      </section>
  </div>);
}

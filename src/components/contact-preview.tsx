"use client";
import type { ReactNode } from "react";
import { ContactPreviewContent, type ContactPreviewState } from "./contact-preview-data";
import { PreviewDialog } from "./preview-dialog";
import { PreviewLink } from "./record-preview";
export { isContactPreviewData, type ContactPreviewData, type ContactPreviewState } from "./contact-preview-data";
export function ContactPreviewDialog({ contactId, contactName, onClose, onRetry, opener, state }: {
  contactId: string;
  contactName: string;
  onClose: () => void;
  onRetry?: () => void;
  opener: HTMLElement | null;
  state: ContactPreviewState;
}) {
  return <PreviewDialog kind="contact" title={state.kind === "ready" ? state.contact.name : contactName} href={`/contacts/${contactId}`} onClose={onClose} opener={opener}>
  {state.kind === "ready" ? <ContactPreviewContent contact={state.contact}/> :
      state.kind === "loading" ? <p>Loading contact preview…</p> :
        <div role="alert"><p>{state.missing ? "Contact not found" : "Could not load this contact"}</p>
    {!state.missing ? <button className="btn" onClick={onRetry}>Retry</button> : null}</div>}
  </PreviewDialog>;
}
export function ContactPreviewTrigger({ children, className = "contact-preview-trigger", contactId, contactName }: {
  children: ReactNode;
  className?: string;
  contactId: string;
  contactName: string;
}) {
  return <PreviewLink href={`/contacts/${contactId}`} className={className} asButton previewTitle={contactName} aria-label={`Preview ${contactName}`}>{children}</PreviewLink>;
}

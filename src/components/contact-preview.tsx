"use client";

import { ExternalLink, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  isContactMethodKind,
  isContactRelationship,
  isNetworkingStatus,
  type ContactMethodKind,
  type ContactRelationship,
  type NetworkingStatus,
} from "@/domain/contact";
import {
  contactMethodKindLabel,
  ContactStatusChip,
  relationshipLabel,
} from "./contact-status";
import { ContactMethodValue } from "./contact-method-value";
import { trapDialogTab } from "./quick-add-dialog";

type ContactPreviewMethod = {
  id: string;
  kind: ContactMethodKind;
  value: string;
  isPrimary: boolean;
  createdAt: string;
};

export type ContactPreviewData = {
  id: string;
  companyId: string | null;
  companyName: string | null;
  name: string;
  designation: string | null;
  relationship: ContactRelationship;
  source: string | null;
  location: string | null;
  notes: string | null;
  preferredContactChannel: ContactMethodKind | null;
  networkingStatus: NetworkingStatus;
  lastInteractionAt: string | null;
  nextAction: string | null;
  followUpOn: string | null;
  methods: ContactPreviewMethod[];
  createdAt: string;
};

export type ContactPreviewState =
  | { kind: "loading" }
  | { kind: "ready"; contact: ContactPreviewData }
  | { kind: "error"; missing: boolean };

function optionalString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isContactPreviewMethod(value: unknown): value is ContactPreviewMethod {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const method = value as Record<string, unknown>;
  return (
    typeof method.id === "string" &&
    isContactMethodKind(method.kind) &&
    typeof method.value === "string" &&
    typeof method.isPrimary === "boolean" &&
    typeof method.createdAt === "string"
  );
}

export function isContactPreviewData(value: unknown): value is ContactPreviewData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const contact = value as Record<string, unknown>;
  return (
    typeof contact.id === "string" &&
    typeof contact.name === "string" &&
    optionalString(contact.companyId) &&
    optionalString(contact.companyName) &&
    optionalString(contact.designation) &&
    isContactRelationship(contact.relationship) &&
    optionalString(contact.source) &&
    optionalString(contact.location) &&
    optionalString(contact.notes) &&
    (contact.preferredContactChannel === null ||
      isContactMethodKind(contact.preferredContactChannel)) &&
    isNetworkingStatus(contact.networkingStatus) &&
    optionalString(contact.lastInteractionAt) &&
    optionalString(contact.nextAction) &&
    optionalString(contact.followUpOn) &&
    Array.isArray(contact.methods) &&
    contact.methods.every(isContactPreviewMethod) &&
    typeof contact.createdAt === "string"
  );
}

function PreviewField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? "Not set"}</dd>
    </div>
  );
}

export function ContactPreviewDialog({
  contactId,
  contactName,
  onClose,
  onRetry,
  opener,
  state,
}: {
  contactId: string;
  contactName: string;
  onClose: () => void;
  onRetry?: () => void;
  opener: HTMLElement | null;
  state: ContactPreviewState;
}) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      dialog
        .querySelector<HTMLElement>("[data-dialog-initial-focus]")
        ?.focus();
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
      window.requestAnimationFrame(() => opener?.focus());
    };
  }, [onClose, opener]);

  const contact = state.kind === "ready" ? state.contact : null;

  return (
    <div
      className="contact-preview-backdrop"
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-labelledby="contact-preview-title"
        aria-modal="true"
        className="contact-preview-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header className="contact-preview-header">
          <div>
            <p className="eyebrow">Contact preview</p>
            <h2 id="contact-preview-title">{contact?.name ?? contactName}</h2>
          </div>
          <button
            aria-label="Close contact preview"
            className="contact-preview-close"
            data-dialog-initial-focus
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div aria-live="polite" className="contact-preview-content">
          {state.kind === "loading" ? (
            <div className="contact-preview-state">
              <p>Loading contact preview…</p>
            </div>
          ) : state.kind === "error" ? (
            <div className="contact-preview-state data-state data-state--error">
              <p>{state.missing ? "Contact not found" : "Could not load this contact"}</p>
              {state.missing ? (
                <p>This contact does not exist in your workspace.</p>
              ) : (
                <>
                  <p>Check the connection and retry.</p>
                  <button className="btn btn--ghost" onClick={onRetry} type="button">
                    Retry
                  </button>
                </>
              )}
            </div>
          ) : contact ? (
            <>
              <div className="contact-preview-status">
                <ContactStatusChip status={contact.networkingStatus} />
              </div>
              <dl className="contact-preview-fields">
                <PreviewField label="Company" value={contact.companyName ?? "No company"} />
                <PreviewField label="Designation" value={contact.designation} />
                <PreviewField
                  label="Relationship"
                  value={relationshipLabel(contact.relationship)}
                />
                <PreviewField label="Location" value={contact.location} />
                <PreviewField label="Next action" value={contact.nextAction} />
                <PreviewField
                  label="Follow-up date"
                  value={
                    contact.followUpOn ? (
                      <span className="tnum">{contact.followUpOn}</span>
                    ) : null
                  }
                />
              </dl>
              <section
                aria-labelledby="contact-preview-methods"
                className="contact-preview-methods"
              >
                <h3 id="contact-preview-methods">Contact methods</h3>
                {contact.methods.length === 0 ? (
                  <p className="section-empty">No contact methods saved.</p>
                ) : (
                  <ul className="contact-method-list">
                    {contact.methods.map((method) => (
                      <li key={method.id}>
                        <span>{contactMethodKindLabel(method.kind)}</span>
                        <ContactMethodValue kind={method.kind} value={method.value} />
                        {method.isPrimary ? <small>Primary</small> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : null}
        </div>

        <footer className="contact-preview-actions">
          <a
            className="btn"
            href={`/contacts/${contactId}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            Open contact in new tab
            <ExternalLink aria-hidden="true" />
          </a>
          <button className="btn btn--ghost" onClick={onClose} type="button">
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}

export function ContactPreviewTrigger({
  children,
  className,
  contactId,
  contactName,
}: {
  children: ReactNode;
  className: string;
  contactId: string;
  contactName: string;
}) {
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ContactPreviewState>({ kind: "loading" });
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();

    void fetch(`/api/contacts/${encodeURIComponent(contactId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) {
          setState({ kind: "error", missing: true });
          return;
        }
        if (!response.ok) {
          setState({ kind: "error", missing: false });
          return;
        }
        const body: unknown = await response.json();
        setState(
          isContactPreviewData(body)
            ? { kind: "ready", contact: body }
            : { kind: "error", missing: false },
        );
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ kind: "error", missing: false });
        }
      });

    return () => controller.abort();
  }, [attempt, contactId, open]);

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={`Preview ${contactName}`}
        className={`contact-preview-trigger ${className}`}
        onClick={(event) => {
          setOpener(event.currentTarget);
          setState({ kind: "loading" });
          setOpen(true);
        }}
        type="button"
      >
        {children}
      </button>
      {open ? (
        <ContactPreviewDialog
          contactId={contactId}
          contactName={contactName}
          onClose={close}
          onRetry={() => {
            setState({ kind: "loading" });
            setAttempt((value) => value + 1);
          }}
          opener={opener}
          state={state}
        />
      ) : null}
    </>
  );
}

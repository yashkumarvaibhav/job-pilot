"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, Send } from "lucide-react";

import {
  renderEmailTemplate,
  type EmailTemplateVariable,
} from "@/domain/mail-template";

export type ComposeAccountOption = {
  id: string;
  email: string;
  senderName: string;
  signature: string | null;
  isDefault: boolean;
};

export type ComposeContactOption = {
  id: string;
  name: string;
  email: string;
  companyName: string | null;
  doNotContact: boolean;
  suppressionReason?: string | null;
};

export type ComposeOpportunityOption = {
  id: string;
  role: string;
  companyName: string;
  jobId: string | null;
  url: string | null;
};

export type ComposeReferralOption = {
  id: string;
  contactId: string;
  opportunityId: string | null;
  label: string;
};

export type ComposeTemplateOption = {
  id: string;
  title: string;
  subject: string;
  body: string;
  defaultEmailAccountId: string | null;
  defaultDocumentVersionId: string | null;
};

export type ComposeDocumentOption = { id: string; displayName: string };

type ComposeInitialSelection = {
  contactId?: string;
  opportunityId?: string;
  referralId?: string;
};

type ComposeApproval =
  | "send_now"
  | "send_tonight"
  | "send_tomorrow"
  | "custom_time";

export function composeVariableValues(input: {
  contact?: ComposeContactOption;
  opportunity?: ComposeOpportunityOption;
  document?: ComposeDocumentOption;
  myName: string;
  myUniversity: string | null;
}): Partial<Record<EmailTemplateVariable, string>> {
  const nameParts = input.contact?.name.trim().split(/\s+/) ?? [];
  return {
    first_name: nameParts[0],
    last_name: nameParts.slice(1).join(" ") || undefined,
    company: input.opportunity?.companyName ?? input.contact?.companyName ?? undefined,
    job_title: input.opportunity?.role,
    job_id: input.opportunity?.jobId ?? undefined,
    job_url: input.opportunity?.url ?? undefined,
    my_name: input.myName || undefined,
    my_university: input.myUniversity ?? undefined,
    resume_name: input.document?.displayName,
  };
}

function responseError(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : "Gmail could not send this email. Check the connection and retry.";
}

export function ComposeForm({
  accounts,
  contacts,
  documents,
  initial,
  myName,
  myUniversity,
  opportunities,
  referrals,
  templates,
  timeZone,
}: {
  accounts: ComposeAccountOption[];
  contacts: ComposeContactOption[];
  documents: ComposeDocumentOption[];
  initial: ComposeInitialSelection;
  myName: string;
  myUniversity: string | null;
  opportunities: ComposeOpportunityOption[];
  referrals: ComposeReferralOption[];
  templates: ComposeTemplateOption[];
  timeZone: string;
}) {
  const router = useRouter();
  const defaultAccount = accounts.find((account) => account.isDefault) ?? accounts[0];
  const [accountId, setAccountId] = useState(defaultAccount.id);
  const [contactId, setContactId] = useState(
    contacts.some((contact) => contact.id === initial.contactId)
      ? initial.contactId!
      : contacts[0]?.id ?? "",
  );
  const [opportunityId, setOpportunityId] = useState(
    opportunities.some((item) => item.id === initial.opportunityId)
      ? initial.opportunityId!
      : "",
  );
  const [referralId, setReferralId] = useState(
    referrals.some((item) => item.id === initial.referralId)
      ? initial.referralId!
      : "",
  );
  const [templateId, setTemplateId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pendingAction, setPendingAction] = useState<ComposeApproval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [customTime, setCustomTime] = useState("");

  const account = accounts.find((item) => item.id === accountId) ?? defaultAccount;
  const contact = contacts.find((item) => item.id === contactId);
  const opportunity = opportunities.find((item) => item.id === opportunityId);
  const document = documents.find((item) => item.id === documentId);
  const variables = useMemo(
    () =>
      composeVariableValues({
        contact,
        opportunity,
        document,
        myName,
        myUniversity,
      }),
    [contact, document, myName, myUniversity, opportunity],
  );
  const rendered = useMemo(
    () => renderEmailTemplate({ subject, body }, variables),
    [body, subject, variables],
  );
  const completeBody = [rendered.body, account.signature?.trim()]
    .filter(Boolean)
    .join("\n\n");
  const blockReason = contact?.suppressionReason ??
    (contact?.doNotContact
      ? "This contact is marked Do Not Contact. Email is blocked."
      : null);
  const blocked = blockReason !== null;

  function chooseTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    setSubject(template.subject);
    setBody(template.body);
    if (
      template.defaultEmailAccountId &&
      accounts.some((item) => item.id === template.defaultEmailAccountId)
    ) {
      setAccountId(template.defaultEmailAccountId);
    }
    if (
      template.defaultDocumentVersionId &&
      documents.some((item) => item.id === template.defaultDocumentVersionId)
    ) {
      setDocumentId(template.defaultDocumentVersionId);
    }
  }

  function chooseReferral(id: string) {
    setReferralId(id);
    const referral = referrals.find((item) => item.id === id);
    if (!referral) return;
    setContactId(referral.contactId);
    setOpportunityId(referral.opportunityId ?? "");
  }

  async function approve(approval: ComposeApproval) {
    setPendingAction(approval);
    setError(null);
    setOutcome(null);
    try {
      const response = await fetch("/api/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          contactId,
          opportunityId: opportunityId || null,
          referralId: referralId || null,
          subject: rendered.subject,
          body: completeBody,
          attachmentVersionIds: documentId ? [documentId] : [],
          approval,
          ...(approval === "custom_time" ? { sendAt: customTime } : {}),
        }),
      });
      const responseBody: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(responseError(responseBody));
        return;
      }
      const queued = responseBody as { status?: unknown; sendAt?: unknown } | null;
      setOutcome(
        queued?.status === "sent"
          ? `Email sent through ${account.email}. The interaction is in the contact timeline.`
          : `Approved for ${
              typeof queued?.sendAt === "string"
                ? new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone,
                  }).format(new Date(queued.sendAt))
                : "the selected time"
            } in ${timeZone}.`,
      );
      router.refresh();
    } catch {
      setError("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPendingAction(null);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void approve("send_now");
  }

  return (
    <form className="compose-form" onSubmit={submit}>
      <section aria-labelledby="compose-addressing" className="compose-panel">
        <div className="compose-panel__heading">
          <p className="eyebrow">Addressing</p>
          <h2 id="compose-addressing">Choose recipient and sender</h2>
        </div>
        <div className="compose-grid">
          <div className="field">
            <label htmlFor="compose-contact">Recipient</label>
            <select
              id="compose-contact"
              onChange={(event) => {
                setContactId(event.target.value);
                const referral = referrals.find((item) => item.id === referralId);
                if (referral && referral.contactId !== event.target.value) setReferralId("");
              }}
              required
              value={contactId}
            >
              {contacts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} — {item.email}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="compose-account">From Gmail account</label>
            <select
              id="compose-account"
              onChange={(event) => setAccountId(event.target.value)}
              required
              value={accountId}
            >
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.email}{item.isDefault ? " — default" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="compose-opportunity">Opportunity</label>
            <select
              id="compose-opportunity"
              onChange={(event) => {
                setOpportunityId(event.target.value);
                const referral = referrals.find((item) => item.id === referralId);
                if (referral && referral.opportunityId !== event.target.value) setReferralId("");
              }}
              value={opportunityId}
            >
              <option value="">No opportunity</option>
              {opportunities.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.companyName} — {item.role}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="compose-referral">Referral</label>
            <select
              id="compose-referral"
              onChange={(event) => chooseReferral(event.target.value)}
              value={referralId}
            >
              <option value="">No referral</option>
              {referrals.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section aria-labelledby="compose-message" className="compose-panel">
        <div className="compose-panel__heading">
          <p className="eyebrow">Message</p>
          <h2 id="compose-message">Write the complete email</h2>
        </div>
        <div className="compose-grid">
          <div className="field">
            <label htmlFor="compose-template">Template</label>
            <select
              id="compose-template"
              onChange={(event) => chooseTemplate(event.target.value)}
              value={templateId}
            >
              <option value="">Start without a template</option>
              {templates.map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="compose-document">Attachment</label>
            <select
              id="compose-document"
              onChange={(event) => setDocumentId(event.target.value)}
              value={documentId}
            >
              <option value="">No attachment</option>
              {documents.map((item) => (
                <option key={item.id} value={item.id}>{item.displayName}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="compose-subject">Subject</label>
          <input
            id="compose-subject"
            maxLength={998}
            onChange={(event) => setSubject(event.target.value)}
            required
            value={subject}
          />
        </div>
        <div className="field">
          <label htmlFor="compose-body">Body</label>
          <textarea
            id="compose-body"
            maxLength={500000}
            onChange={(event) => setBody(event.target.value)}
            required
            rows={12}
            value={body}
          />
        </div>
      </section>

      <section aria-labelledby="compose-review" className="compose-panel compose-review">
        <div className="compose-panel__heading">
          <p className="eyebrow">Final review</p>
          <h2 id="compose-review">Review exactly what Gmail will send</h2>
        </div>
        {rendered.warnings.length > 0 ? (
          <div className="compose-warning" role="status">
            <AlertTriangle aria-hidden="true" />
            <p>
              Unresolved variables stay visible: {rendered.warnings.map((item) => `{{${item.variable}}}`).join(", ")}.
            </p>
          </div>
        ) : null}
        {blocked ? (
          <div className="compose-block" role="alert">
            <AlertTriangle aria-hidden="true" />
            <p>{blockReason} There is no Send anyway button.</p>
          </div>
        ) : null}
        <dl className="compose-review__facts">
          <div><dt>Recipient</dt><dd>{contact ? `${contact.name} <${contact.email}>` : "Choose a contact"}</dd></div>
          <div><dt>Account</dt><dd>{account.email}</dd></div>
          <div><dt>Subject</dt><dd>{rendered.subject || "No subject"}</dd></div>
          <div><dt>Attachment</dt><dd>{document?.displayName ?? "None"}</dd></div>
          <div><dt>Send time</dt><dd>Chosen below in {timeZone}; that click is the approval</dd></div>
        </dl>
        <div className="compose-preview">
          <h3>Complete body</h3>
          <pre>{completeBody || "Write a message to preview it here."}</pre>
        </div>
        {error ? (
          <p className="form-alert" role="alert">
            <AlertTriangle aria-hidden="true" />
            {error}
          </p>
        ) : null}
        {outcome ? (
          <p className="form-notice" role="status">
            <CheckCircle2 aria-hidden="true" />
            {outcome}
          </p>
        ) : null}
        {!blocked ? (
          <div className="compose-actions">
            <button
              className="btn compose-send"
              disabled={pendingAction !== null || !contact || !rendered.subject || !completeBody}
              type="submit"
            >
              <Send aria-hidden="true" />
              {pendingAction === "send_now" ? "Sending…" : `Send now from ${account.email}`}
            </button>
            <button
              className="btn btn--ghost"
              disabled={pendingAction !== null || !contact || !rendered.subject || !completeBody}
              onClick={() => void approve("send_tonight")}
              type="button"
            >
              <Clock3 aria-hidden="true" />
              {pendingAction === "send_tonight" ? "Scheduling…" : "Send tonight"}
            </button>
            <button
              className="btn btn--ghost"
              disabled={pendingAction !== null || !contact || !rendered.subject || !completeBody}
              onClick={() => void approve("send_tomorrow")}
              type="button"
            >
              <CalendarClock aria-hidden="true" />
              {pendingAction === "send_tomorrow" ? "Scheduling…" : "Send tomorrow morning"}
            </button>
            <div className="field compose-custom-time">
              <label htmlFor="compose-custom-time">Custom time in {timeZone}</label>
              <input
                id="compose-custom-time"
                onChange={(event) => setCustomTime(event.target.value)}
                type="datetime-local"
                value={customTime}
              />
            </div>
            <button
              className="btn btn--ghost"
              disabled={
                pendingAction !== null ||
                !contact ||
                !rendered.subject ||
                !completeBody ||
                !customTime
              }
              onClick={() => void approve("custom_time")}
              type="button"
            >
              <CalendarClock aria-hidden="true" />
              {pendingAction === "custom_time" ? "Scheduling…" : "Approve custom time"}
            </button>
          </div>
        ) : null}
      </section>
    </form>
  );
}

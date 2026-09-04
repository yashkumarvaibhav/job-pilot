"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import {
  SEQUENCE_CANCEL_COPY,
  SEQUENCE_ENROLLMENT_COPY,
  SEQUENCE_STOP_REASON_COPY,
  type SequenceCancelReason,
} from "@/domain/sequence";

export type SequenceEnrollOption = { id: string; name: string };
export type SequenceAccountOption = { id: string; email: string };
export type SequenceEnrollmentRow = {
  id: string;
  sequenceName: string;
  status: "active" | "cancelled" | "completed";
  cancelReason: SequenceCancelReason | string | null;
  nextAt: string;
};

function responseError(value: unknown, fallback: string) {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

export function SequenceEnrollForm({
  accounts,
  contacts,
  defaultContactId,
  defaultOpportunityId,
  enrollments,
  opportunities,
  sequences,
}: {
  accounts: SequenceAccountOption[];
  contacts?: SequenceEnrollOption[];
  defaultContactId?: string;
  defaultOpportunityId?: string | null;
  enrollments: SequenceEnrollmentRow[];
  opportunities?: SequenceEnrollOption[];
  sequences: SequenceEnrollOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function enroll(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sequenceId = String(form.get("sequenceId") ?? "");
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/sequences/${encodeURIComponent(sequenceId)}/enroll`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contactId: String(form.get("contactId") ?? defaultContactId ?? ""),
            accountId: String(form.get("accountId") ?? ""),
            opportunityId:
              String(form.get("opportunityId") ?? defaultOpportunityId ?? "") ||
              null,
          }),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(responseError(body, "Could not enroll this contact."));
        return;
      }
      setMessage("Enrolled. Each due email requires your approval.");
      router.refresh();
    } catch {
      setError("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  async function stop(enrollmentId: string) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/enrollments/${encodeURIComponent(enrollmentId)}/stop`,
        { method: "POST" },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(responseError(body, "Could not stop this enrollment."));
        return;
      }
      setMessage("Stopped. Every awaiting, approved or held row is cancelled.");
      router.refresh();
    } catch {
      setError("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="sequence-enroll">
      <p>{SEQUENCE_ENROLLMENT_COPY}</p>
      {error ? (
        <p className="form-alert" role="alert">
          <AlertTriangle aria-hidden="true" />
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="form-notice" role="status">
          <CheckCircle2 aria-hidden="true" />
          {message}
        </p>
      ) : null}
      {enrollments.length === 0 ? (
        <p className="section-empty">Not enrolled in a sequence yet.</p>
      ) : (
        <ul className="sequence-enrollment-list">
          {enrollments.map((enrollment) => (
            <li key={enrollment.id}>
              <div>
                <strong>{enrollment.sequenceName}</strong>
                <span>
                  {enrollment.status === "cancelled" && enrollment.cancelReason
                    ? SEQUENCE_CANCEL_COPY[
                        enrollment.cancelReason as SequenceCancelReason
                      ] ?? enrollment.status
                    : enrollment.status}
                </span>
              </div>
              {enrollment.status === "active" ? (
                <button
                  className="btn btn--danger"
                  disabled={pending}
                  onClick={() => void stop(enrollment.id)}
                  type="button"
                >
                  Stop
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {sequences.length === 0 || accounts.length === 0 || (contacts && contacts.length === 0) ? (
        <p className="section-empty">
          {sequences.length === 0
            ? "Create a sequence in Settings before enrolling."
            : accounts.length === 0
              ? "Connect a Gmail account in Settings before enrolling."
              : "Link a contact before enrolling."}
        </p>
      ) : (
        <form className="sequence-enroll-form" onSubmit={(event) => void enroll(event)}>
          <div className="field">
            <label htmlFor="sequence-enroll-sequence">Sequence</label>
            <select id="sequence-enroll-sequence" name="sequenceId" required>
              {sequences.map((sequence) => (
                <option key={sequence.id} value={sequence.id}>
                  {sequence.name}
                </option>
              ))}
            </select>
          </div>
          {contacts ? (
            <div className="field">
              <label htmlFor="sequence-enroll-contact">Contact</label>
              <select
                defaultValue={defaultContactId}
                id="sequence-enroll-contact"
                name="contactId"
                required
              >
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {opportunities ? (
            <div className="field">
              <label htmlFor="sequence-enroll-opportunity">Opportunity</label>
              <select
                defaultValue={defaultOpportunityId ?? ""}
                id="sequence-enroll-opportunity"
                name="opportunityId"
              >
                <option value="">No linked job</option>
                {opportunities.map((opportunity) => (
                  <option key={opportunity.id} value={opportunity.id}>
                    {opportunity.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="sequence-enroll-account">Gmail account</label>
            <select id="sequence-enroll-account" name="accountId" required>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.email}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" disabled={pending} type="submit">
            Enroll
          </button>
        </form>
      )}
      <p>
        Stop reasons: {SEQUENCE_STOP_REASON_COPY.join(", ")}.
      </p>
    </div>
  );
}

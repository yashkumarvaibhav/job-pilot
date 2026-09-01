"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { INTERACTION_CHANNELS } from "@/domain/interaction";
import {
  REFERRAL_STAGES,
  type ReferralStage,
} from "@/domain/referral";

type ContactOption = { id: string; name: string };
type OpportunityOption = { id: string; role: string; companyName: string };

function responseError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

function payloadFromForm(form: FormData) {
  const opportunityId = String(form.get("opportunityId") ?? "");
  return {
    contactId: String(form.get("contactId") ?? ""),
    opportunityId: opportunityId.length > 0 ? opportunityId : null,
    requestedOn: String(form.get("requestedOn") ?? ""),
    channel: String(form.get("channel") ?? ""),
    resumeShared: form.get("resumeShared") === "on",
    jobIdShared: form.get("jobIdShared") === "on",
    jobUrlShared: form.get("jobUrlShared") === "on",
    stage: String(form.get("stage") ?? ""),
    followUpOn: String(form.get("followUpOn") ?? ""),
    receivedOn: String(form.get("receivedOn") ?? ""),
    confirmation: String(form.get("confirmation") ?? ""),
    nextAction: String(form.get("nextAction") ?? ""),
    notes: String(form.get("notes") ?? ""),
  };
}

export function ReferralCreateForm({
  contacts,
  defaultContactId,
  defaultOpportunityId,
  defaultStage = "potential_contact",
  defaultRequestedOn,
  opportunities,
  submitLabel = "Add referral",
}: {
  contacts: ContactOption[];
  opportunities: OpportunityOption[];
  defaultContactId?: string;
  defaultOpportunityId?: string;
  defaultStage?: ReferralStage;
  defaultRequestedOn?: string;
  submitLabel?: string;
}) {
  const formId = useId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/referrals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payloadFromForm(new FormData(event.currentTarget))),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(body, "Could not save this referral."));
        return;
      }
      if (
        typeof body === "object" &&
        body !== null &&
        "id" in body &&
        typeof (body as { id: unknown }).id === "string" &&
        !defaultOpportunityId &&
        !defaultContactId
      ) {
        router.push(`/referrals/${(body as { id: string }).id}`);
        return;
      }
      router.refresh();
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-busy={pending} className="referral-form" onSubmit={submit}>
      <div className="referral-form-grid">
        <div className="field">
          <label htmlFor={`${formId}-contact`}>Contact</label>
          <select
            defaultValue={defaultContactId ?? ""}
            disabled={pending || Boolean(defaultContactId)}
            id={`${formId}-contact`}
            name="contactId"
            required
          >
            <option disabled value="">
              Choose a contact
            </option>
            {contacts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {defaultContactId ? (
            <input name="contactId" type="hidden" value={defaultContactId} />
          ) : null}
        </div>
        <div className="field">
          <label htmlFor={`${formId}-opportunity`}>Opportunity</label>
          <select
            defaultValue={defaultOpportunityId ?? ""}
            disabled={pending || Boolean(defaultOpportunityId)}
            id={`${formId}-opportunity`}
            name="opportunityId"
          >
            <option value="">No opportunity yet</option>
            {opportunities.map((item) => (
              <option key={item.id} value={item.id}>
                {item.companyName} {item.role}
              </option>
            ))}
          </select>
          {defaultOpportunityId ? (
            <input
              name="opportunityId"
              type="hidden"
              value={defaultOpportunityId}
            />
          ) : null}
        </div>
        <div className="field">
          <label htmlFor={`${formId}-stage`}>Stage</label>
          <select
            defaultValue={defaultStage}
            disabled={pending}
            id={`${formId}-stage`}
            name="stage"
          >
            {REFERRAL_STAGES.map((stage) => (
              <option key={stage.value} value={stage.value}>
                {stage.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-channel`}>Channel</label>
          <select
            defaultValue=""
            disabled={pending}
            id={`${formId}-channel`}
            name="channel"
            required
          >
            <option disabled value="">
              Choose a channel
            </option>
            {INTERACTION_CHANNELS.map((channel) => (
              <option key={channel.value} value={channel.value}>
                {channel.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-requested`}>Date requested</label>
          <input
            defaultValue={defaultRequestedOn ?? ""}
            disabled={pending}
            id={`${formId}-requested`}
            name="requestedOn"
            type="date"
          />
        </div>
      </div>
      {message ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {message}
        </p>
      ) : null}
      <button className="btn" disabled={pending} type="submit">
        {submitLabel}
      </button>
    </form>
  );
}

export function ReferralEditForm({
  contacts,
  opportunities,
  referral,
}: {
  contacts: ContactOption[];
  opportunities: OpportunityOption[];
  referral: {
    id: string;
    contactId: string;
    opportunityId: string | null;
    requestedOn: string | null;
    channel: string;
    resumeShared: boolean;
    jobIdShared: boolean;
    jobUrlShared: boolean;
    stage: ReferralStage;
    followUpOn: string | null;
    receivedOn: string | null;
    confirmation: string | null;
    nextAction: string | null;
    notes: string | null;
  };
}) {
  const formId = useId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/referrals/${referral.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payloadFromForm(new FormData(event.currentTarget))),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(body, "Could not save this referral."));
        return;
      }
      router.refresh();
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-busy={pending} className="referral-form" onSubmit={submit}>
      <div className="referral-form-grid">
        <div className="field">
          <label htmlFor={`${formId}-contact`}>Contact</label>
          <select
            defaultValue={referral.contactId}
            disabled={pending}
            id={`${formId}-contact`}
            name="contactId"
            required
          >
            {contacts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-opportunity`}>Opportunity</label>
          <select
            defaultValue={referral.opportunityId ?? ""}
            disabled={pending}
            id={`${formId}-opportunity`}
            name="opportunityId"
          >
            <option value="">No opportunity yet</option>
            {opportunities.map((item) => (
              <option key={item.id} value={item.id}>
                {item.companyName} {item.role}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-stage`}>Stage</label>
          <select
            defaultValue={referral.stage}
            disabled={pending}
            id={`${formId}-stage`}
            name="stage"
          >
            {REFERRAL_STAGES.map((stage) => (
              <option key={stage.value} value={stage.value}>
                {stage.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-channel`}>Channel</label>
          <select
            defaultValue={referral.channel}
            disabled={pending}
            id={`${formId}-channel`}
            name="channel"
            required
          >
            {INTERACTION_CHANNELS.map((channel) => (
              <option key={channel.value} value={channel.value}>
                {channel.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-requested`}>Date requested</label>
          <input
            defaultValue={referral.requestedOn ?? ""}
            disabled={pending}
            id={`${formId}-requested`}
            name="requestedOn"
            type="date"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-follow`}>Next follow-up date</label>
          <input
            defaultValue={referral.followUpOn ?? ""}
            disabled={pending}
            id={`${formId}-follow`}
            name="followUpOn"
            type="date"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-received`}>Referral received date</label>
          <input
            defaultValue={referral.receivedOn ?? ""}
            disabled={pending}
            id={`${formId}-received`}
            name="receivedOn"
            type="date"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-next`}>Next action</label>
          <input
            defaultValue={referral.nextAction ?? ""}
            disabled={pending}
            id={`${formId}-next`}
            name="nextAction"
            type="text"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-confirmation`}>Referral confirmation</label>
          <input
            defaultValue={referral.confirmation ?? ""}
            disabled={pending}
            id={`${formId}-confirmation`}
            name="confirmation"
            type="text"
          />
        </div>
        <label className="checkbox-field" htmlFor={`${formId}-resume`}>
          <input
            defaultChecked={referral.resumeShared}
            disabled={pending}
            id={`${formId}-resume`}
            name="resumeShared"
            type="checkbox"
          />
          <span>Resume shared?</span>
        </label>
        <label className="checkbox-field" htmlFor={`${formId}-jobid`}>
          <input
            defaultChecked={referral.jobIdShared}
            disabled={pending}
            id={`${formId}-jobid`}
            name="jobIdShared"
            type="checkbox"
          />
          <span>Job ID shared?</span>
        </label>
        <label className="checkbox-field" htmlFor={`${formId}-joburl`}>
          <input
            defaultChecked={referral.jobUrlShared}
            disabled={pending}
            id={`${formId}-joburl`}
            name="jobUrlShared"
            type="checkbox"
          />
          <span>Job URL shared?</span>
        </label>
        <div className="field">
          <label htmlFor={`${formId}-notes`}>Notes</label>
          <textarea
            defaultValue={referral.notes ?? ""}
            disabled={pending}
            id={`${formId}-notes`}
            name="notes"
            rows={4}
          />
        </div>
      </div>
      {message ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {message}
        </p>
      ) : null}
      <button className="btn" disabled={pending} type="submit">
        Save referral
      </button>
    </form>
  );
}

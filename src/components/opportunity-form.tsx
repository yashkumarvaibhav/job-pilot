"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  OPPORTUNITY_BUCKETS,
  OPPORTUNITY_SELECTABLE_STAGES,
  opportunityStageLabel,
  type OpportunityStage,
} from "@/domain/opportunity";
import type { Opportunity } from "@/server/repos/opportunities";

type CompanyOption = { id: string; name: string };
type FormValues = Omit<
  Pick<
    Opportunity,
    | "companyId"
    | "role"
    | "jobId"
    | "url"
    | "location"
    | "workMode"
    | "employmentType"
    | "experienceRequirement"
    | "source"
    | "discoveredOn"
    | "postedOn"
    | "deadlineOn"
    | "compensation"
    | "priority"
    | "interestScore"
    | "eligibility"
    | "referralPreferred"
    | "resumeVersionId"
    | "jdSnapshot"
    | "notes"
    | "tagsJson"
    | "bucket"
    | "stage"
    | "nextAction"
    | "nextActionDue"
  >,
  "stage"
> & { stage: OpportunityStage };

type Props = {
  companies: CompanyOption[];
  endpoint: string;
  method: "POST" | "PUT";
  initial?: FormValues;
  submitLabel: string;
  onSaved: (value: { id: string }) => void;
};

function responseError(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : "Could not save the opportunity. Check the fields and retry.";
}

function OpportunityForm({
  companies,
  endpoint,
  method,
  initial,
  submitLabel,
  onSaved,
}: Props) {
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const interest = String(form.get("interestScore") ?? "").trim();
    const payload = {
      companyId: String(form.get("companyId") ?? ""),
      role: String(form.get("role") ?? ""),
      jobId: String(form.get("jobId") ?? ""),
      url: String(form.get("url") ?? ""),
      location: String(form.get("location") ?? ""),
      workMode: String(form.get("workMode") ?? ""),
      employmentType: String(form.get("employmentType") ?? ""),
      experienceRequirement: String(form.get("experienceRequirement") ?? ""),
      source: String(form.get("source") ?? ""),
      discoveredOn: String(form.get("discoveredOn") ?? ""),
      postedOn: String(form.get("postedOn") ?? ""),
      deadlineOn: String(form.get("deadlineOn") ?? ""),
      compensation: String(form.get("compensation") ?? ""),
      priority: String(form.get("priority") ?? ""),
      interestScore: interest === "" ? null : Number(interest),
      eligibility: String(form.get("eligibility") ?? ""),
      referralPreferred: form.get("referralPreferred") === "on",
      resumeVersionId: String(form.get("resumeVersionId") ?? ""),
      jdSnapshot: String(form.get("jdSnapshot") ?? ""),
      notes: String(form.get("notes") ?? ""),
      tags: String(form.get("tags") ?? "").split(","),
      bucket: String(form.get("bucket") ?? "saved"),
      stage:
        initial?.stage === "applied"
          ? undefined
          : String(form.get("stage") ?? "discovered"),
      nextAction: String(form.get("nextAction") ?? ""),
      nextActionDue: String(form.get("nextActionDue") ?? ""),
    };

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(body));
        return;
      }
      if (typeof body !== "object" || body === null || !("id" in body)) {
        setMessage("The opportunity saved, but its response was incomplete. Reload the page.");
        return;
      }
      onSaved(body as { id: string });
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  const textFields = [
    ["role", "Role", true],
    ["jobId", "Job ID"],
    ["url", "Job URL"],
    ["location", "Location"],
    ["workMode", "Work mode"],
    ["employmentType", "Employment type"],
    ["experienceRequirement", "Experience requirement"],
    ["source", "Source"],
    ["compensation", "Salary / compensation"],
    ["priority", "Priority"],
    ["eligibility", "Eligibility"],
    ["resumeVersionId", "Resume version ID"],
    ["nextAction", "Next action"],
  ] as const;

  return (
    <form aria-busy={pending} className="opportunity-form" onSubmit={submit}>
      <div className="opportunity-form-grid">
        <div className="field">
          <label htmlFor={`${formId}-company`}>Company</label>
          <select defaultValue={initial?.companyId ?? ""} disabled={pending} id={`${formId}-company`} name="companyId" required>
            <option disabled value="">Choose a company</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
        </div>
        {textFields.map(([name, label, required]) => (
          <div className="field" key={name}>
            <label htmlFor={`${formId}-${name}`}>{label}</label>
            <input
              defaultValue={(initial?.[name] as string | null | undefined) ?? ""}
              disabled={pending}
              id={`${formId}-${name}`}
              name={name}
              required={required}
              type={name === "url" ? "url" : "text"}
            />
          </div>
        ))}
        {(["discoveredOn", "postedOn", "deadlineOn", "nextActionDue"] as const).map((name) => (
          <div className="field" key={name}>
            <label htmlFor={`${formId}-${name}`}>
              {name === "discoveredOn"
                ? "Date discovered"
                : name === "postedOn"
                  ? "Posting date"
                  : name === "deadlineOn"
                    ? "Deadline"
                    : "Next action due"}
            </label>
            <input
              className="tnum"
              defaultValue={initial?.[name] ?? ""}
              disabled={pending}
              id={`${formId}-${name}`}
              name={name}
              type="date"
            />
          </div>
        ))}
        <div className="field">
          <label htmlFor={`${formId}-interest`}>Interest score</label>
          <input defaultValue={initial?.interestScore ?? ""} disabled={pending} id={`${formId}-interest`} name="interestScore" step="1" type="number" />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-bucket`}>Bucket</label>
          <select defaultValue={initial?.bucket ?? "saved"} disabled={pending} id={`${formId}-bucket`} name="bucket">
            {OPPORTUNITY_BUCKETS.map((bucket) => <option key={bucket.value} value={bucket.value}>{bucket.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-stage`}>Pursuit stage</label>
          <select defaultValue={initial?.stage === "applied" ? "ready_to_apply" : initial?.stage ?? "discovered"} disabled={pending || initial?.stage === "applied"} id={`${formId}-stage`} name="stage">
            {OPPORTUNITY_SELECTABLE_STAGES.map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-tags`}>Tags</label>
          <input defaultValue={initial?.tagsJson.join(", ") ?? ""} disabled={pending} id={`${formId}-tags`} name="tags" placeholder="backend, new grad" />
        </div>
      </div>

      <label className="checkbox-field" htmlFor={`${formId}-referral`}>
        <input defaultChecked={initial?.referralPreferred ?? false} disabled={pending} id={`${formId}-referral`} name="referralPreferred" type="checkbox" />
        <span>Referral preferred</span>
      </label>
      <div className="field">
        <label htmlFor={`${formId}-snapshot`}>Job description snapshot</label>
        <textarea defaultValue={initial?.jdSnapshot ?? ""} disabled={pending} id={`${formId}-snapshot`} name="jdSnapshot" rows={8} />
      </div>
      <div className="field">
        <label htmlFor={`${formId}-notes`}>Notes</label>
        <textarea defaultValue={initial?.notes ?? ""} disabled={pending} id={`${formId}-notes`} name="notes" rows={4} />
      </div>
      {message ? <p className="form-alert" role="alert"><span aria-hidden="true">!</span>{message}</p> : null}
      <button className="btn" disabled={pending} type="submit">{pending ? "Saving…" : submitLabel}</button>
    </form>
  );
}

export function OpportunityStageChip({ stage }: { stage: OpportunityStage }) {
  return <span className="chip opportunity-stage-chip"><svg aria-hidden="true" fill="currentColor" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" /></svg>{opportunityStageLabel(stage)}</span>;
}

export function OpportunityCreatePanel({ companies }: { companies: CompanyOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (companies.length === 0) {
    return <div className="company-required"><button className="btn" disabled type="button">Add job</button><p>Add a company before adding a job.</p></div>;
  }
  return <div className="opportunity-create-panel">
    <button aria-controls="new-opportunity-form" aria-expanded={open} className={open ? "btn btn--ghost" : "btn"} onClick={() => setOpen((value) => !value)} type="button">{open ? "Cancel" : "Add job"}</button>
    {open ? <section className="card opportunity-form-card" id="new-opportunity-form"><h2>Add job</h2><p>Capture the opening first; people and referrals attach later.</p><OpportunityForm companies={companies} endpoint="/api/opportunities" method="POST" onSaved={(created) => router.push(`/opportunities/${created.id}`)} submitLabel="Save job" /></section> : null}
  </div>;
}

export function OpportunityEditForm({ companies, opportunity }: { companies: CompanyOption[]; opportunity: FormValues & { id: string } }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  return <div className="card opportunity-form-card opportunity-form-card--edit"><OpportunityForm companies={companies} endpoint={`/api/opportunities/${opportunity.id}`} initial={opportunity} method="PUT" onSaved={() => { setSaved(true); router.refresh(); }} submitLabel="Save changes" /><p aria-live="polite" className="save-status">{saved ? "Opportunity updated." : ""}</p></div>;
}

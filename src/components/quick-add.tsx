"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { CONTACT_RELATIONSHIPS } from "@/domain/contact";
import {
  parseDuplicateConflict,
  type DuplicateConflict,
} from "@/domain/duplicate";
import { INTERVIEW_KIND_SUGGESTIONS } from "@/domain/interview";
import { INTERACTION_CHANNELS } from "@/domain/interaction";
import { DuplicateWarning } from "./duplicate-warning";
import { QuickAddDialog } from "./quick-add-dialog";

export type QuickAddReferenceData = {
  companies: { id: string; name: string }[];
  contacts: { id: string; name: string }[];
  opportunities: {
    id: string;
    companyName: string;
    role: string;
  }[];
  today: string;
};

export const QUICK_ADD_ACTIONS = [
  { key: "job", label: "Add job", shortcut: "j" },
  { key: "company", label: "Add company", shortcut: "c" },
  { key: "contact", label: "Add contact", shortcut: "p" },
  { key: "interaction", label: "Log interaction", shortcut: "l" },
  { key: "application", label: "Add application", shortcut: "a" },
  { key: "interview", label: "Add interview", shortcut: "i" },
  { key: "task", label: "Add task", shortcut: "t" },
  {
    key: "compose",
    label: "Compose email",
    shortcut: "e",
  },
  { key: "reminder", label: "Create reminder", shortcut: "r" },
] as const;

export type QuickAddAction = (typeof QUICK_ADD_ACTIONS)[number]["key"];

type SavedValue = { id: string };

function responseError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

class DuplicatePostError extends Error {
  readonly conflict: DuplicateConflict;

  constructor(conflict: DuplicateConflict) {
    super(conflict.error);
    this.name = "DuplicatePostError";
    this.conflict = conflict;
  }
}

async function postJson(
  endpoint: string,
  payload: Record<string, unknown>,
  fallback: string,
): Promise<SavedValue> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body: unknown = await response.json().catch(() => null);
  const conflict = parseDuplicateConflict(response.status, body);
  if (conflict) throw new DuplicatePostError(conflict);
  if (!response.ok) throw new Error(responseError(body, fallback));
  if (typeof body !== "object" || body === null || !("id" in body)) {
    throw new Error("The item saved, but its response was incomplete. Reload the page.");
  }
  return body as SavedValue;
}

export function companyNameFromJobUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    const labels = url.hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .split(".")
      .filter(Boolean);
    const candidate =
      labels.find((label) => !["jobs", "careers", "apply", "boards"].includes(label)) ??
      labels[0];
    return candidate
      ? candidate
          .split(/[-_]/)
          .filter(Boolean)
          .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
          .join(" ")
      : "";
  } catch {
    return "";
  }
}

function ActionMenu({ onSelect }: { onSelect: (action: QuickAddAction) => void }) {
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const action = QUICK_ADD_ACTIONS.find(
      (item) => item.shortcut === event.key.toLowerCase() && !("disabled" in item),
    );
    if (!action) return;
    event.preventDefault();
    onSelect(action.key);
  }

  return (
    <div className="quick-add-action-list" onKeyDown={onKeyDown}>
      {QUICK_ADD_ACTIONS.map((action, index) => {
        const disabled =
          "disabled" in action && typeof action.disabled === "string"
            ? action.disabled
            : null;
        const descriptionId = disabled ? `quick-add-${action.key}-note` : undefined;
        return (
          <div className="quick-add-action" key={action.key}>
            <button
              aria-describedby={descriptionId}
              className="quick-add-action-button"
              data-dialog-initial-focus={index === 0 ? "true" : undefined}
              disabled={Boolean(disabled)}
              onClick={() => onSelect(action.key)}
              type="button"
            >
              <span>{action.label}</span>
              <kbd>C {action.shortcut.toUpperCase()}</kbd>
            </button>
            {disabled ? (
              <p id={descriptionId}>{disabled}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function QuickAddForm({
  action,
  data,
  onSaved,
}: {
  action: Exclude<QuickAddAction, "compose">;
  data: QuickAddReferenceData;
  onSaved: (path: string) => void;
}) {
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<DuplicateConflict | null>(null);
  const [retry, setRetry] = useState<(() => Promise<void>) | null>(null);
  const [jobCompany, setJobCompany] = useState("");
  const [jobCompanyTouched, setJobCompanyTouched] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setConflict(null);
    setRetry(null);
    const form = new FormData(event.currentTarget);

    try {
      if (action === "company") {
        const payload = { name: String(form.get("name") ?? "") };
        const run = async (acknowledgeDuplicates = false) => {
          const saved = await postJson(
            "/api/companies",
            acknowledgeDuplicates
              ? { ...payload, acknowledgeDuplicates: true }
              : payload,
            "Could not save the company.",
          );
          onSaved(`/companies/${saved.id}`);
        };
        try {
          await run();
        } catch (error) {
          if (error instanceof DuplicatePostError) {
            setConflict(error.conflict);
            setRetry(() => () => run(true));
            return;
          }
          throw error;
        }
        return;
      }

      if (action === "contact") {
        const email = String(form.get("email") ?? "").trim();
        const saved = await postJson(
          "/api/contacts",
          {
            name: String(form.get("name") ?? ""),
            companyName: String(form.get("companyName") ?? ""),
            relationship: String(form.get("relationship") ?? "unknown_cold_contact"),
            preferredContactChannel: email ? "email" : null,
            methods: email ? [{ kind: "email", value: email, isPrimary: true }] : [],
          },
          "Could not save the contact.",
        );
        onSaved(`/contacts/${saved.id}`);
        return;
      }

      if (action === "job") {
        const companyName = jobCompany.trim();
        const jobPayload = {
          role: String(form.get("role") ?? ""),
          jobId: String(form.get("jobId") ?? ""),
          url: String(form.get("url") ?? ""),
          bucket: "saved",
          stage: "discovered",
          tags: [],
        };
        const run = async (
          acknowledgeCompany = false,
          acknowledgeJob = false,
        ) => {
          let companyId = data.companies.find(
            (company) =>
              company.name.toLocaleLowerCase() === companyName.toLocaleLowerCase(),
          )?.id;
          if (!companyId) {
            const company = await postJson(
              "/api/companies",
              acknowledgeCompany
                ? { name: companyName, acknowledgeDuplicates: true }
                : { name: companyName },
              "Could not save the company for this job.",
            );
            companyId = company.id;
          }
          await postJson(
            "/api/opportunities",
            acknowledgeJob
              ? { ...jobPayload, companyId, acknowledgeDuplicates: true }
              : { ...jobPayload, companyId },
            "Could not save the job.",
          );
          onSaved("/opportunities");
        };
        try {
          await run();
        } catch (error) {
          if (error instanceof DuplicatePostError) {
            setConflict(error.conflict);
            setRetry(
              () => () =>
                run(
                  error.conflict.candidates[0]?.entityType === "company",
                  error.conflict.candidates[0]?.entityType === "opportunity",
                ),
            );
            return;
          }
          throw error;
        }
        return;
      }

      if (action === "interaction") {
        const contactId = String(form.get("contactId") ?? "");
        await postJson(
          `/api/contacts/${encodeURIComponent(contactId)}/interactions`,
          {
            channel: String(form.get("channel") ?? "whatsapp"),
            direction: "inbound",
            body: String(form.get("body") ?? ""),
          },
          "Could not log the interaction.",
        );
        onSaved(`/contacts/${contactId}`);
        return;
      }

      if (action === "application") {
        await postJson(
          "/api/applications",
          {
            opportunityId: String(form.get("opportunityId") ?? ""),
            portal: String(form.get("portal") ?? ""),
            appliedOn: String(form.get("appliedOn") ?? ""),
          },
          "Could not save the application.",
        );
        onSaved("/applications");
        return;
      }

      if (action === "interview") {
        const opportunityId = String(form.get("opportunityId") ?? "");
        const dateOn = String(form.get("dateOn") ?? "");
        const time = String(form.get("time") ?? "");
        await postJson(
          "/api/interviews",
          {
            opportunityId,
            kind: String(form.get("kind") ?? ""),
            dateOn: time ? dateOn : "",
            time,
            interviewer: String(form.get("interviewer") ?? ""),
          },
          "Could not save the interview.",
        );
        onSaved(`/opportunities/${opportunityId}`);
        return;
      }

      await postJson(
        "/api/tasks",
        {
          title: String(form.get("title") ?? ""),
          dueOn: String(form.get("dueOn") ?? ""),
          priority: "medium",
        },
        action === "reminder" ? "Could not create the reminder." : "Could not save the task.",
      );
      onSaved("/tasks");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reach Job Pilot. Retry.");
    } finally {
      setPending(false);
    }
  }

  const noContacts = action === "interaction" && data.contacts.length === 0;
  const noOpportunities =
    (action === "application" || action === "interview") &&
    data.opportunities.length === 0;

  return (
    <form
      aria-busy={pending}
      className={`quick-add-form quick-add-form--${action}`}
      onSubmit={submit}
    >
      <fieldset className="quick-add-fields" disabled={pending || noContacts || noOpportunities}>
        {action === "company" ? (
          <div className="field">
            <label htmlFor={`${formId}-company-name`}>Company name</label>
            <input autoFocus id={`${formId}-company-name`} name="name" required />
          </div>
        ) : null}

        {action === "contact" ? (
          <>
            <div className="field">
              <label htmlFor={`${formId}-contact-name`}>Name</label>
              <input autoFocus id={`${formId}-contact-name`} name="name" required />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-contact-company`}>Company</label>
              <input
                id={`${formId}-contact-company`}
                list={`${formId}-contact-company-options`}
                name="companyName"
              />
              <datalist id={`${formId}-contact-company-options`}>
                {data.companies.map((company) => (
                  <option key={company.id} value={company.name} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label htmlFor={`${formId}-contact-relationship`}>Relationship</label>
              <select defaultValue="unknown_cold_contact" id={`${formId}-contact-relationship`} name="relationship">
                {CONTACT_RELATIONSHIPS.map((relationship) => (
                  <option key={relationship.value} value={relationship.value}>{relationship.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${formId}-contact-email`}>Email</label>
              <input id={`${formId}-contact-email`} name="email" type="email" />
            </div>
          </>
        ) : null}

        {action === "job" ? (
          <>
            <div className="field quick-add-wide">
              <label htmlFor={`${formId}-job-url`}>Job URL</label>
              <input
                autoFocus
                id={`${formId}-job-url`}
                name="url"
                onChange={(event) => {
                  if (!jobCompanyTouched) setJobCompany(companyNameFromJobUrl(event.target.value));
                }}
                type="url"
              />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-job-company`}>Company</label>
              <input
                id={`${formId}-job-company`}
                list={`${formId}-company-options`}
                name="companyName"
                onChange={(event) => {
                  setJobCompanyTouched(true);
                  setJobCompany(event.target.value);
                }}
                required
                value={jobCompany}
              />
              <datalist id={`${formId}-company-options`}>
                {data.companies.map((company) => <option key={company.id} value={company.name} />)}
              </datalist>
            </div>
            <div className="field">
              <label htmlFor={`${formId}-job-role`}>Role</label>
              <input id={`${formId}-job-role`} name="role" required />
            </div>
            <div className="field quick-add-wide">
              <label htmlFor={`${formId}-job-id`}>Job ID</label>
              <input id={`${formId}-job-id`} name="jobId" />
            </div>
          </>
        ) : null}

        {action === "interaction" ? (
          <>
            {noContacts ? <p className="quick-add-empty">Add a contact before logging an interaction.</p> : null}
            <div className="field">
              <label htmlFor={`${formId}-interaction-contact`}>Person</label>
              <select autoFocus id={`${formId}-interaction-contact`} name="contactId" required>
                <option disabled value="">Choose a contact</option>
                {data.contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${formId}-interaction-channel`}>Channel</label>
              <select defaultValue="whatsapp" id={`${formId}-interaction-channel`} name="channel" required>
                {INTERACTION_CHANNELS.map((channel) => <option key={channel.value} value={channel.value}>{channel.label}</option>)}
              </select>
            </div>
            <div className="field quick-add-wide">
              <label htmlFor={`${formId}-interaction-body`}>Message</label>
              <textarea id={`${formId}-interaction-body`} name="body" required rows={2} />
            </div>
          </>
        ) : null}

        {action === "application" ? (
          <>
            {noOpportunities ? <p className="quick-add-empty">Add a job before recording an application.</p> : null}
            <div className="field quick-add-wide">
              <label htmlFor={`${formId}-application-opportunity`}>Job</label>
              <select autoFocus id={`${formId}-application-opportunity`} name="opportunityId" required>
                <option disabled value="">Choose a job</option>
                {data.opportunities.map((opportunity) => (
                  <option key={opportunity.id} value={opportunity.id}>{opportunity.companyName} — {opportunity.role}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${formId}-application-portal`}>Portal</label>
              <input id={`${formId}-application-portal`} name="portal" required />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-application-date`}>Applied date</label>
              <input className="tnum" defaultValue={data.today} id={`${formId}-application-date`} name="appliedOn" required type="date" />
            </div>
          </>
        ) : null}

        {action === "interview" ? (
          <>
            {noOpportunities ? <p className="quick-add-empty">Add a job before adding an interview.</p> : null}
            <div className="field quick-add-wide">
              <label htmlFor={`${formId}-interview-opportunity`}>Job</label>
              <select autoFocus id={`${formId}-interview-opportunity`} name="opportunityId" required>
                <option disabled value="">Choose a job</option>
                {data.opportunities.map((opportunity) => (
                  <option key={opportunity.id} value={opportunity.id}>{opportunity.companyName} — {opportunity.role}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${formId}-interview-kind`}>Round type</label>
              <input id={`${formId}-interview-kind`} list={`${formId}-interview-kinds`} name="kind" required />
              <datalist id={`${formId}-interview-kinds`}>
                {INTERVIEW_KIND_SUGGESTIONS.map((kind) => (
                  <option key={kind} value={kind} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label htmlFor={`${formId}-interview-interviewer`}>Interviewer</label>
              <input id={`${formId}-interview-interviewer`} name="interviewer" />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-interview-date`}>Date</label>
              <input className="tnum" defaultValue={data.today} id={`${formId}-interview-date`} name="dateOn" type="date" />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-interview-time`}>Time</label>
              <input className="tnum" id={`${formId}-interview-time`} name="time" type="time" />
            </div>
          </>
        ) : null}

        {action === "task" || action === "reminder" ? (
          <>
            <div className="field">
              <label htmlFor={`${formId}-task-title`}>Title</label>
              <input autoFocus id={`${formId}-task-title`} name="title" required />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-task-due`}>Due date</label>
              <input className="tnum" id={`${formId}-task-due`} name="dueOn" required={action === "reminder"} type="date" />
            </div>
          </>
        ) : null}
      </fieldset>

      {conflict ? (
        <DuplicateWarning
          conflict={conflict}
          pending={pending}
          onCancel={() => {
            setConflict(null);
          }}
          onCreateAnyway={() => {
            if (!retry) return;
            setPending(true);
            setMessage(null);
            void retry()
              .catch((error: unknown) => {
                if (error instanceof DuplicatePostError) {
                  setConflict(error.conflict);
                  return;
                }
                setMessage(
                  error instanceof Error
                    ? error.message
                    : "Could not reach Job Pilot. Check the connection and retry.",
                );
              })
              .finally(() => setPending(false));
          }}
        />
      ) : null}
      {message ? <p className="form-alert" role="alert"><span aria-hidden="true">!</span>{message}</p> : null}
      <button className="btn quick-add-save" disabled={pending || noContacts || noOpportunities} type="submit">
        {pending ? "Saving…" : action === "interaction" ? "Save interaction" : action === "reminder" ? "Create reminder" : "Save"}
      </button>
    </form>
  );
}

export function QuickAdd({
  data,
  initialAction = null,
  onClose,
  returnFocusTo,
}: {
  data: QuickAddReferenceData;
  initialAction?: QuickAddAction | null;
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
}) {
  const router = useRouter();
  const [action, setAction] = useState<QuickAddAction | null>(initialAction);
  const selected = QUICK_ADD_ACTIONS.find((item) => item.key === action);
  const enabledAction = selected && !("disabled" in selected) ? selected.key : null;
  const formAction = enabledAction === "compose" ? null : enabledAction;

  function chooseAction(next: QuickAddAction) {
    if (next === "compose") {
      onClose();
      router.push("/compose");
      return;
    }
    setAction(next);
  }

  function saved(path: string) {
    onClose();
    router.push(path);
    router.refresh();
  }

  return (
    <QuickAddDialog
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      title={selected?.label ?? "Add to Job Pilot"}
    >
      {formAction ? (
        <div className="quick-add-panel">
          <button className="quick-add-back" onClick={() => setAction(null)} type="button">← All quick-add actions</button>
          <QuickAddForm action={formAction} data={data} onSaved={saved} />
        </div>
      ) : (
        <ActionMenu onSelect={chooseAction} />
      )}
    </QuickAddDialog>
  );
}

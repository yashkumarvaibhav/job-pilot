"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore, type ComponentProps, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { ContactPreviewContent, isContactPreviewData } from "./contact-preview-data";
import { PreviewDialog } from "./preview-dialog";
type RecordKind = "contact" | "company" | "opportunity" | "referral" | "application";
const KINDS: Record<string, RecordKind> = {
  contacts: "contact", companies: "company", opportunities: "opportunity", referrals: "referral", applications: "application",
};
const EXTERNAL_DESTINATION = /^https?:\/\//i;
/**
 * A forced preview still has to have something to show. A record has its own
 * facts; an external address is worth reading before leaving the product. An
 * internal route would only echo its own path back, so it navigates instead.
 */
export function previewable(href: string, forced: boolean) {
  return previewTarget(href) !== null || (forced && EXTERNAL_DESTINATION.test(href));
}
export function previewTarget(href: string) {
  if (!href.startsWith("/") || href.startsWith("//"))
    return null;
  const url = new URL(href, "https://jobpilot.invalid.test");
  if (url.pathname === "/applications" && url.searchParams.has("preview"))
    return { kind: "application" as const, endpoint: `/api/applications/${encodeURIComponent(url.searchParams.get("preview")!)}`, section: url.hash };
  const match = /^\/(contacts|companies|opportunities|referrals|applications)\/([^/]+)$/.exec(url.pathname);
  if (!match)
    return null;
  return { kind: KINDS[match[1]], endpoint: `/api${url.pathname}`, section: url.hash };
}
const FIELDS: Record<Exclude<RecordKind, "contact">, [
  string,
  string
][]> = {
  company: [["Industry", "industry"], ["Type", "type"], ["Locations", "locations"], ["Target company", "target"], ["Website", "website"], ["Careers", "careersUrl"], ["Next action", "nextAction"], ["Due date", "nextActionDue"], ["Notes", "notes"]],
  opportunity: [["Company", "companyName"], ["Job ID", "jobId"], ["Pursuit stage", "stage"], ["Bucket", "bucket"], ["Location", "location"], ["Work mode", "workMode"], ["Employment type", "employmentType"], ["Priority", "priority"], ["Deadline", "deadlineOn"], ["Compensation", "compensation"], ["Next action", "nextAction"], ["Due date", "nextActionDue"], ["Notes", "notes"]],
  referral: [["Contact", "contactName"], ["Company", "companyName"], ["Role", "role"], ["Stage", "stage"], ["Requested", "requestedOn"], ["Channel", "channel"], ["Follow-up date", "followUpOn"], ["Resume shared", "resumeShared"], ["Confirmation", "confirmation"], ["Next action", "nextAction"], ["Notes", "notes"]],
  application: [["Company", "companyName"], ["Role", "role"], ["Stage", "stage"], ["Applied", "appliedOn"], ["Portal", "portal"], ["Result", "result"], ["Offer deadline", "offerDeadlineOn"], ["Notes", "notes"]],
};
type Payload = Record<string, unknown>;
type Related = {
  id: string;
  label: string;
  href: string;
};
type State = {
  kind: "loading";
} | {
  kind: "error";
  missing: boolean;
  signedOut?: boolean;
} | {
  kind: "ready";
  data: Payload;
  contacts?: Related[];
  opportunities?: Related[];
};
function object(value: unknown): value is Payload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function valueText(value: unknown): string {
  return typeof value === "boolean" ? value ? "Yes" : "No" :
    typeof value === "string" && value ? value : typeof value === "number" ? String(value) : "Not set";
}
function labelText(value: unknown) {
  const text = valueText(value).replaceAll("_", " ");
  return text[0].toUpperCase() + text.slice(1);
}
export function RecordPreview({ href, title, opener, onClose }: {
  href: string;
  title: string;
  opener: HTMLElement | null;
  onClose: () => void;
}) {
  const [destination, setDestination] = useState({ href, title });
  const target = previewTarget(destination.href);
  const kind = target?.kind ?? "page";
  const endpoint = target?.endpoint;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!endpoint)
      return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint!, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          if (!controller.signal.aborted)
            setState({ kind: "error", missing: response.status === 404, signedOut: response.status === 401 });
          return;
        }
        const data: unknown = await response.json();
        if (!object(data) || typeof data.id !== "string" ||
          (kind === "contact" ? !isContactPreviewData(data) :
            typeof data[kind === "company" ? "name" : kind === "opportunity" ? "role" : kind === "referral" ? "contactName" : "opportunityId"] !== "string"))
          throw new Error("Invalid preview");
        let contacts: Related[] | undefined;
        let opportunities: Related[] | undefined;
        if (kind === "company") {
          const lists = await Promise.all(["contacts", "opportunities"].map(async (collection) => {
            const result = await fetch(`/api/${collection}?company=${encodeURIComponent(data.id as string)}`, { cache: "no-store", signal: controller.signal });
            if (!result.ok)
              throw new Error("Could not load related records");
            const rows: unknown = await result.json();
            if (!Array.isArray(rows) || !rows.every((row) => object(row) && typeof row.id === "string"))
              throw new Error("Invalid related records");
            return rows.map((row: Payload) => ({ id: row.id as string, label: valueText(row.name ?? row.role), href: `/${collection}/${encodeURIComponent(row.id as string)}` }));
          }));
          [contacts, opportunities] = lists;
        }
        if (!controller.signal.aborted)
          setState({ kind: "ready", data, contacts, opportunities });
      }
      catch {
        if (!controller.signal.aborted)
          setState({ kind: "error", missing: false });
      }
    }
    void load();
    return () => controller.abort();
  }, [endpoint, kind, attempt]);
  const data = state.kind === "ready" ? state.data : null;
  const heading = data ? valueText(kind === "referral" ? `${valueText(data.contactName)} referral` : data.name ?? data.role ?? destination.title) : destination.title;
  const fullHref = kind === "application" && typeof data?.opportunityId === "string"
    ? `/opportunities/${encodeURIComponent(data.opportunityId)}#application` : destination.href;
  function navigate(row: Related) {
    document.querySelector<HTMLElement>(".contact-preview-dialog [data-dialog-initial-focus]")?.focus();
    setState({ kind: "loading" });
    setDestination({ href: row.href, title: row.label });
  }
  function related(label: string, rows: Related[] | undefined) {
    if (!rows)
      return null;
    return <section className="contact-preview-methods"><h3>{label} ({rows.length})</h3>
      {rows.length ? <ul className="preview-related-list">{rows.map((row) => <li key={row.id}>
    <a className="table-link" href={row.href} aria-haspopup="dialog" onClick={(event) => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
              return;
            event.preventDefault();
            navigate(row);
          }}>{row.label}</a>
      </li>)}</ul> : <p>No {label.toLowerCase()} saved.</p>}</section>;
  }
  return createPortal(<PreviewDialog kind={kind} title={heading} href={fullHref} opener={opener} onClose={onClose}>
  {destination.href !== href ? <button className="btn btn--ghost" onClick={() => navigate({ href, label: title, id: "back" })}>Back to {title}</button> : null}
  {!target ? <><p>Open this destination in a new tab to view the full page.</p>
      <dl className="contact-preview-fields"><div><dt>Destination</dt><dd>{destination.href}</dd></div></dl></> :
      state.kind === "loading" ? <div className="contact-preview-state"><p>Loading {kind} preview…</p></div> :
        state.kind === "error" ? <div role="alert" className="contact-preview-state data-state--error">
    <p>{state.missing ? `${labelText(kind)} not found` : state.signedOut ? "Sign in to view this record" : `Could not load this ${kind}`}</p>
    <p>{state.missing ? "This record does not exist in your workspace." : state.signedOut ? "Your session has ended. Open the page in a new tab to sign in." : "Check the connection and retry."}</p>
    {!state.missing ? <button className="btn btn--ghost" onClick={() => { setState({ kind: "loading" }); setAttempt((n) => n + 1); }}>Retry</button> : null}
      </div> : data ? <>
    {kind === "contact" && isContactPreviewData(data) ? <ContactPreviewContent contact={data}/> :
            <dl className="contact-preview-fields">{FIELDS[kind as Exclude<RecordKind, "contact">].map(([label, key]) => <div key={key}><dt>{label}</dt><dd className="tnum">{["stage", "bucket", "channel", "result"].includes(key) ? labelText(data[key]) : valueText(data[key])}</dd></div>)}</dl>}
    {kind === "opportunity" && object(data.application) ? <section><h3>Application</h3><dl className="contact-preview-fields">
          {[["Stage", "stage"], ["Applied", "appliedOn"], ["Portal", "portal"]].map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{labelText((data.application as Payload)[key])}</dd></div>)}
    </dl></section> : null}
    {related("Contacts", state.contacts)}{related("Opportunities", state.opportunities)}
      </> : null}
  </PreviewDialog>, document.body);
}
type Props = ComponentProps<"a"> & {
  href: string;
  preview?: boolean;
  previewTitle?: string;
  asButton?: boolean;
};
const subscribeToHydration = () => () => {};

export function PreviewLink({ children, href, preview = false, previewTitle, asButton = false, ...props }: Props) {
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const url = href;
  const enabled = previewable(url, preview);
  const [selected, setSelected] = useState<{
    opener: HTMLElement;
    title: string;
  } | null>(null);
  const close = useCallback(() => setSelected(null), []);
  function open(event: MouseEvent<HTMLElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    setSelected({ opener: event.currentTarget, title: previewTitle ?? event.currentTarget.textContent?.trim() ?? "Page" });
  }
  const offsite = EXTERNAL_DESTINATION.test(url);
  const Anchor = offsite ? "a" : Link;
  if (!enabled)
    return <Anchor href={href} {...props}>{children}</Anchor>;
  return <>
  {asButton ? <button disabled={!hydrated} data-preview-ready={hydrated} className={`contact-preview-trigger ${props.className ?? ""}`} type="button" aria-label={props["aria-label"]} aria-haspopup="dialog" onClick={open}>{children}</button> :
      <Anchor {...props} href={href} inert={!hydrated} data-preview-ready={hydrated} aria-haspopup="dialog" onClick={(event) => { props.onClick?.(event); open(event); }}>{children}</Anchor>}
  {selected ? <RecordPreview href={url} title={selected.title} opener={selected.opener} onClose={close}/> : null}
  </>;
}

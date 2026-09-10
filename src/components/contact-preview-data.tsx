import type { ReactNode } from "react";
import { isContactMethodKind, isContactRelationship, isNetworkingStatus, type ContactMethodKind, type ContactRelationship, type NetworkingStatus, } from "@/domain/contact";
import { contactMethodKindLabel, ContactStatusChip, relationshipLabel, } from "./contact-status";
import { ContactMethodValue } from "./contact-method-value";
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
export type ContactPreviewState = {
  kind: "loading";
} | {
  kind: "ready";
  contact: ContactPreviewData;
} | {
  kind: "error";
  missing: boolean;
};
function optionalString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
function isContactPreviewMethod(value: unknown): value is ContactPreviewMethod {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const method = value as Record<string, unknown>;
  return (typeof method.id === "string" &&
    isContactMethodKind(method.kind) &&
    typeof method.value === "string" &&
    typeof method.isPrimary === "boolean" &&
    typeof method.createdAt === "string");
}
export function isContactPreviewData(value: unknown): value is ContactPreviewData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const contact = value as Record<string, unknown>;
  return (typeof contact.id === "string" &&
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
    typeof contact.createdAt === "string");
}
function PreviewField({ label, value }: {
  label: string;
  value: ReactNode;
}) {
  return (<div>
      <dt>{label}</dt>
      <dd>{value ?? "Not set"}</dd>
  </div>);
}
export function ContactPreviewContent({ contact }: {
  contact: ContactPreviewData;
}) {
  return <>
              <div className="contact-preview-status">
        <ContactStatusChip status={contact.networkingStatus}/>
              </div>
              <dl className="contact-preview-fields">
        <PreviewField label="Company" value={contact.companyName ?? "No company"}/>
        <PreviewField label="Designation" value={contact.designation}/>
        <PreviewField label="Relationship" value={relationshipLabel(contact.relationship)}/>
        <PreviewField label="Location" value={contact.location}/>
        <PreviewField label="Next action" value={contact.nextAction}/>
        <PreviewField label="Follow-up date" value={contact.followUpOn ? (<span className="tnum">{contact.followUpOn}</span>) : null}/>
              </dl>
              <section aria-labelledby="contact-preview-methods" className="contact-preview-methods">
        <h3 id="contact-preview-methods">Contact methods</h3>
        {contact.methods.length === 0 ? (<p className="section-empty">No contact methods saved.</p>) : (<ul className="contact-method-list">
          {contact.methods.map((method) => (<li key={method.id}>
            <span>{contactMethodKindLabel(method.kind)}</span>
            <ContactMethodValue preview={false} kind={method.kind} value={method.value}/>
            {method.isPrimary ? <small>Primary</small> : null}
                      </li>))}
                  </ul>)}
              </section>
  </>;
}

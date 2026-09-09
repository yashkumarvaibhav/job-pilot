import Link from "next/link";

import { Link2, Mail } from "lucide-react";

import { ContactCreatePanel } from "@/components/contact-form";
import { ContactPreviewTrigger } from "@/components/contact-preview";
import { ListToolbar, type AppliedFilter } from "@/components/list-toolbar";
import {
  RecordCard,
  RecordCards,
  gmailComposeUrl,
} from "@/components/record-card";
import {
  SavedSearchForm,
  SavedSearchLinks,
} from "@/components/saved-search-panel";
import { StaleFlag } from "@/components/stale-chip";
import {
  ContactStatusChip,
  relationshipLabel,
} from "@/components/contact-status";
import {
  CONTACT_RELATIONSHIPS,
  NETWORKING_STATUSES,
} from "@/domain/contact";
import {
  listHref,
  pageSearchParams,
  recordCountLabel,
  withoutParams,
  type PageSearchParams,
} from "@/domain/list-filter";
import { calendarDateInZone } from "@/domain/referral";
import { requireTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import { listCompanies } from "@/server/repos/companies";
import {
  listContacts,
  parseContactListFilter,
} from "@/server/repos/contacts";
import { savedSearchResponse } from "@/server/repos/saved-search-http";
import { listSavedSearches } from "@/server/repos/saved-searches";
import { listStaleIndex } from "@/server/repos/rules";

type Props = { searchParams?: Promise<PageSearchParams> };

export default async function ContactsPage({ searchParams }: Props = {}) {
  const tenant = await requireTenant();
  const database = getDatabase();
  const query = pageSearchParams(await searchParams);
  const filter = parseContactListFilter(query);
  const contacts = listContacts(database, tenant, filter);
  const companies = listCompanies(database, tenant);
  const searches = listSavedSearches(database, tenant, "contacts").map(
    savedSearchResponse,
  );
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  const stale = listStaleIndex(
    database,
    tenant,
    calendarDateInZone(timeZone),
  );
  const hasFilters = Object.keys(filter).length > 0;
  const companyName = companies.find(
    (company) => company.id === filter.companyId,
  )?.name;
  const applied: AppliedFilter[] = [
    ...(filter.companyId !== undefined
      ? [
          {
            key: "company",
            label: "Company",
            value: companyName ?? filter.companyId,
          },
        ]
      : []),
    ...(filter.status !== undefined
      ? [
          {
            key: "status",
            label: "Status",
            value:
              NETWORKING_STATUSES.find((item) => item.value === filter.status)
                ?.label ?? filter.status,
          },
        ]
      : []),
    ...(filter.relationship !== undefined
      ? [
          {
            key: "relationship",
            label: "Relationship",
            value: relationshipLabel(filter.relationship),
          },
        ]
      : []),
    ...(filter.noResponseDays !== undefined
      ? [
          {
            key: "noResponseDays",
            label: "No response for",
            value: `At least ${filter.noResponseDays} days`,
          },
        ]
      : []),
  ].map((item) => ({
    ...item,
    clearHref: listHref("/contacts", withoutParams(query, item.key)),
  }));
  const savedSearchQuery = query.toString();

  return (
    <section className="contact-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Networking CRM</p>
          <h1>Contacts</h1>
          <p className="page-lede">
            Keep every relationship and follow-up visible, even before a role
            exists.
          </p>
        </div>
        <ContactCreatePanel companies={companies} />
      </header>

      <ListToolbar
        applied={applied}
        clearAllHref="/contacts"
        countLabel={recordCountLabel(contacts.length, "contact", "contacts")}
        filterFormLabel="contact"
        savedSearches={<SavedSearchLinks searches={searches} />}
      >
        <form aria-label="Filter contacts" className="list-filter" method="get">
          <div className="list-filter__fields">
            <div className="field">
              <label htmlFor="contact-company-filter">Company</label>
              <select
                defaultValue={filter.companyId ?? ""}
                id="contact-company-filter"
                name="company"
              >
                <option value="">All companies</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="contact-status-filter">Status</label>
              <select
                defaultValue={filter.status ?? ""}
                id="contact-status-filter"
                name="status"
              >
                <option value="">All statuses</option>
                {NETWORKING_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="contact-relationship-filter">Relationship</label>
              <select
                defaultValue={filter.relationship ?? ""}
                id="contact-relationship-filter"
                name="relationship"
              >
                <option value="">All relationships</option>
                {CONTACT_RELATIONSHIPS.map((relationship) => (
                  <option key={relationship.value} value={relationship.value}>
                    {relationship.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="contact-response-filter">No response for</label>
              <select
                defaultValue={filter.noResponseDays?.toString() ?? ""}
                id="contact-response-filter"
                name="noResponseDays"
              >
                <option value="">Any response age</option>
                <option value="3">At least 3 days</option>
                <option value="7">At least 7 days</option>
                <option value="14">At least 14 days</option>
                <option value="30">At least 30 days</option>
              </select>
            </div>
          </div>
        <div className="list-filter__actions">
            <button className="btn" type="submit">
              Apply filters
            </button>
            {applied.length > 0 ? (
              <Link className="btn btn--ghost" href="/contacts">
                Clear filters
              </Link>
            ) : null}
          </div>
        </form>
        {savedSearchQuery ? (
          <SavedSearchForm entityType="contacts" query={savedSearchQuery} />
        ) : null}
      </ListToolbar>

      {contacts.length === 0 ? (
        <div className="data-state data-state--empty">
          <p>
            {hasFilters
              ? "No contacts match these filters."
              : "No contacts yet. Networking does not need a job first."}
          </p>
        </div>
      ) : (
        <RecordCards label="Contacts">
          {contacts.map((contact) => (
            <RecordCard
              chips={<StaleFlag reasons={stale.contact.get(contact.id) ?? []} />}
              destinations={[
                {
                  key: "linkedin",
                  label: "LinkedIn",
                  missingLabel: "No LinkedIn saved",
                  href: contact.linkedinUrl,
                  icon: <Link2 aria-hidden="true" />,
                },
                {
                  key: "email",
                  label: "Gmail",
                  missingLabel: "No email saved",
                  href: gmailComposeUrl(contact.emailAddress),
                  icon: <Mail aria-hidden="true" />,
                },
              ]}
              facts={[
                {
                  label: "Company",
                  value: contact.companyName ?? "No company",
                },
                {
                  label: "Relationship",
                  value: relationshipLabel(contact.relationship),
                },
                {
                  label: "Last interaction",
                  value:
                    contact.lastInteractionAt?.toISOString().slice(0, 10) ??
                    "None logged",
                },
                { label: "Follow-up", value: contact.followUpOn ?? "None set" },
                {
                  label: "Next action",
                  value: contact.nextAction ?? "None set",
                },
              ]}
              heading={
                <ContactPreviewTrigger
                  contactId={contact.id}
                  contactName={contact.name}
                >
                  {contact.name}
                </ContactPreviewTrigger>
              }
              key={contact.id}
              status={<ContactStatusChip status={contact.networkingStatus} />}
              subtitle={contact.designation}
            />
          ))}
        </RecordCards>
      )}
    </section>
  );
}

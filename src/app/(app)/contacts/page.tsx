import Link from "next/link";

import { ContactCreatePanel } from "@/components/contact-form";
import { SavedSearchPanel } from "@/components/saved-search-panel";
import {
  ContactStatusChip,
  relationshipLabel,
} from "@/components/contact-status";
import {
  CONTACT_RELATIONSHIPS,
  NETWORKING_STATUSES,
} from "@/domain/contact";
import {
  pageSearchParams,
  type PageSearchParams,
} from "@/domain/list-filter";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { listCompanies } from "@/server/repos/companies";
import {
  listContacts,
  parseContactListFilter,
} from "@/server/repos/contacts";
import { savedSearchResponse } from "@/server/repos/saved-search-http";
import { listSavedSearches } from "@/server/repos/saved-searches";

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
  const hasFilters = Object.keys(filter).length > 0;

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
          {hasFilters ? (
            <Link className="btn btn--ghost" href="/contacts">
              Clear filters
            </Link>
          ) : null}
        </div>
      </form>

      <SavedSearchPanel
        entityType="contacts"
        query={query.toString()}
        searches={searches}
      />

      {contacts.length === 0 ? (
        <div className="data-state data-state--empty">
          <p>
            {hasFilters
              ? "No contacts match these filters."
              : "No contacts yet. Networking does not need a job first."}
          </p>
        </div>
      ) : (
        <>
          <div className="table-scroll contact-table-wrap">
            <table className="tbl contact-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Company</th>
                  <th scope="col">Relationship</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last interaction</th>
                  <th scope="col">Follow-up</th>
                  <th scope="col">Next action</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact.id}>
                    <td>
                      <Link className="table-link" href={`/contacts/${contact.id}`}>
                        {contact.name}
                      </Link>
                    </td>
                    <td>{contact.companyName ?? "No company"}</td>
                    <td>{relationshipLabel(contact.relationship)}</td>
                    <td>
                      <ContactStatusChip status={contact.networkingStatus} />
                    </td>
                    <td className="tnum">
                      {contact.lastInteractionAt?.toISOString().slice(0, 10) ?? "—"}
                    </td>
                    <td className="tnum">{contact.followUpOn ?? "—"}</td>
                    <td>{contact.nextAction ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul aria-label="Contacts" className="contact-card-list">
            {contacts.map((contact) => (
              <li key={contact.id}>
                <Link className="contact-list-card" href={`/contacts/${contact.id}`}>
                  <span className="contact-list-card__heading">
                    <strong>{contact.name}</strong>
                    <ContactStatusChip status={contact.networkingStatus} />
                  </span>
                  <span>
                    {contact.companyName ?? "No company"}
                    {contact.designation ? ` · ${contact.designation}` : ""}
                  </span>
                  <span>{relationshipLabel(contact.relationship)}</span>
                  <span className="tnum">
                    {contact.nextAction ?? "No next action"}
                    {contact.followUpOn ? ` · ${contact.followUpOn}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

import Link from "next/link";

import { ContactCreatePanel } from "@/components/contact-form";
import {
  ContactStatusChip,
  relationshipLabel,
} from "@/components/contact-status";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { listCompanies } from "@/server/repos/companies";
import { listContacts } from "@/server/repos/contacts";

export default async function ContactsPage() {
  const tenant = await requireTenant();
  const database = getDatabase();
  const contacts = listContacts(database, tenant);
  const companies = listCompanies(database, tenant);

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

      {contacts.length === 0 ? (
        <div className="data-state data-state--empty">
          <p>No contacts yet. Networking does not need a job first.</p>
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

import Link from "next/link";

import { ComposeForm } from "@/components/compose-form";
import { calendarDateInZone } from "@/domain/referral";
import { requireTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import { getContact, listContacts } from "@/server/repos/contacts";
import { listVersionChoices } from "@/server/repos/documents";
import { listEmailAccounts } from "@/server/repos/email-accounts";
import { listEmailTemplates } from "@/server/repos/email-content";
import { listOpportunities } from "@/server/repos/opportunities";
import { listReferrals } from "@/server/repos/referrals";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export default async function ComposePage({ searchParams }: Props) {
  const tenant = await requireTenant();
  const database = getDatabase();
  const settings = getWorkspaceSettings(database, tenant, tenant.workspaceId);
  const timeZone = settings?.timezone ?? DEFAULT_TIME_ZONE;
  const accounts = listEmailAccounts(database, tenant)
    .filter((account) => account.status === "connected")
    .map((account) => ({
      id: account.id,
      email: account.email,
      senderName: account.senderName,
      signature: account.signature,
      isDefault: account.isDefault,
    }));
  const contacts = listContacts(database, tenant)
    .map((row) => {
      const detail = getContact(database, tenant, row.id);
      const emailMethods = detail?.methods.filter((method) => method.kind === "email") ?? [];
      const email = emailMethods.find((method) => method.isPrimary) ?? emailMethods[0];
      return email
        ? {
            id: row.id,
            name: row.name,
            email: email.value,
            companyName: row.companyName,
            doNotContact: row.networkingStatus === "do_not_contact",
          }
        : null;
    })
    .filter((row) => row !== null);
  const opportunities = listOpportunities(database, tenant, "all").map((row) => ({
    id: row.id,
    role: row.role,
    companyName: row.companyName,
    jobId: row.jobId,
    url: row.url,
  }));
  const referrals = listReferrals(database, tenant, {
    asOfOn: calendarDateInZone(timeZone),
  }).map((row) => ({
    id: row.id,
    contactId: row.contactId,
    opportunityId: row.opportunityId,
    label: `${row.contactName}${row.companyName && row.role ? ` — ${row.companyName} ${row.role}` : ""}`,
  }));
  const templates = listEmailTemplates(database, tenant).map((row) => ({
    id: row.id,
    title: row.title,
    subject: row.subject,
    body: row.body,
    defaultEmailAccountId: row.defaultEmailAccountId,
    defaultDocumentVersionId: row.defaultDocumentVersionId,
  }));
  const query = await searchParams;

  return (
    <article className="compose-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Gmail</p>
          <h1>Compose email</h1>
          <p className="page-lede">
            Job Pilot fills only the variables you choose. You write and approve every message.
          </p>
        </div>
        <span className="chip settings-chip settings-chip--pilot">
          Limited pilot
        </span>
      </header>
      {accounts.length === 0 ? (
        <section className="data-state data-state--empty">
          <h2>Connect Gmail before composing</h2>
          <p>Add or reconnect a Gmail identity in Settings. Job Pilot will not choose a sender silently.</p>
          <Link className="btn" href="/settings">Open Gmail settings</Link>
        </section>
      ) : contacts.length === 0 ? (
        <section className="data-state data-state--empty">
          <h2>No contact email is available</h2>
          <p>Add an email address to a contact before composing.</p>
          <Link className="btn btn--ghost" href="/contacts">Open contacts</Link>
        </section>
      ) : (
        <ComposeForm
          accounts={accounts}
          contacts={contacts}
          documents={listVersionChoices(database, tenant)}
          initial={{
            contactId: one(query.contactId),
            opportunityId: one(query.opportunityId),
            referralId: one(query.referralId),
          }}
          myName={settings?.displayName ?? ""}
          myUniversity={settings?.university ?? null}
          opportunities={opportunities}
          referrals={referrals}
          templates={templates}
        />
      )}
    </article>
  );
}

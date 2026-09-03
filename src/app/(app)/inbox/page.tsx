import { InboxWorkspace } from "@/components/inbox-workspace";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { getMailReadDependencies } from "@/server/mail/runtime";
import { listContacts } from "@/server/repos/contacts";
import { listEmailAccounts } from "@/server/repos/email-accounts";
import {
  getInboxThread,
  listInboxThreads,
} from "@/server/repos/inbox-content";

export default async function InboxPage() {
  const tenant = await requireTenant();
  const database = getDatabase();
  const accounts = listEmailAccounts(database, tenant).map((account) => ({
    id: account.id,
    email: account.email,
    status: account.status,
    lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
    sequenceSafeAt: account.sequenceSafeAt?.toISOString() ?? null,
    lastSyncError: account.lastSyncError,
  }));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const contacts = listContacts(database, tenant).map((contact) => ({
    id: contact.id,
    name: contact.name,
    companyName: contact.companyName,
  }));
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const threads = listInboxThreads(database, tenant).flatMap((thread) => {
    const detail = getInboxThread(database, tenant, thread.id);
    const account = accountById.get(thread.accountId);
    if (!detail || !account) return [];
    const messages = detail.messages.map((message) => ({
      id: message.id,
      direction: message.direction,
      fromEmail: message.fromEmail,
      to: message.toJson,
      subject: message.subject,
      body: message.body,
      sentAt: message.sentAt.toISOString(),
      classification: message.classification,
    }));
    const participants = messages.flatMap((message) => [
      message.fromEmail,
      ...message.to,
    ]);
    const counterpartEmail =
      participants.find(
        (email) => email.toLowerCase() !== account.email.toLowerCase(),
      ) ?? "Unknown sender";
    const linkedContact = thread.contactId
      ? contactById.get(thread.contactId)
      : null;
    return [
      {
        id: thread.id,
        accountId: thread.accountId,
        accountEmail: account.email,
        accountStatus: account.status,
        counterpartEmail,
        subject: thread.subject || "(no subject)",
        contactId: thread.contactId,
        linkedLabel: linkedContact
          ? `${linkedContact.name}${linkedContact.companyName ? ` — ${linkedContact.companyName}` : ""}`
          : "Unmatched",
        matchStatus: thread.matchStatus,
        matchReason: thread.matchReason,
        suggestedContacts: thread.suggestedContactIdsJson.flatMap((id) => {
          const candidate = contactById.get(id);
          return candidate ? [{ id, name: candidate.name }] : [];
        }),
        lastMessageAt: thread.lastMessageAt.toISOString(),
        messages,
      },
    ];
  });

  return (
    <InboxWorkspace
      accounts={accounts}
      contacts={contacts}
      gmailConfigured={getMailReadDependencies() !== null}
      threads={threads}
    />
  );
}

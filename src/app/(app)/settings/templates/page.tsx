import { TemplateManager } from "@/components/template-manager";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { listVersionChoices } from "@/server/repos/documents";
import { listEmailAccounts } from "@/server/repos/email-accounts";
import {
  ensureEmailTemplateShells,
  listEmailTemplates,
} from "@/server/repos/email-content";

export default async function TemplatesPage() {
  const tenant = await requireTenant();
  const database = getDatabase();
  ensureEmailTemplateShells(database, tenant);
  const accounts = listEmailAccounts(database, tenant)
    .filter((account) => account.status === "connected")
    .map((account) => ({ id: account.id, email: account.email }));

  return (
    <section className="settings-content template-page">
      <header className="settings-heading">
        <p className="eyebrow">Outreach</p>
        <h1>Email templates</h1>
        <p>
          Thirteen section 16 starting points, empty of generated copy and ready for your wording.
        </p>
      </header>
      <TemplateManager
        accounts={accounts}
        documents={listVersionChoices(database, tenant)}
        templates={listEmailTemplates(database, tenant)}
      />
    </section>
  );
}

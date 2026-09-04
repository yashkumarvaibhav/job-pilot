import { SequenceManager } from "@/components/sequence-manager";
import { SEQUENCE_ENROLLMENT_COPY } from "@/domain/sequence";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  ensureEmailTemplateShells,
  listEmailTemplates,
} from "@/server/repos/email-content";
import { listSequences } from "@/server/repos/sequences";

export default async function SequencesPage() {
  const tenant = await requireTenant();
  const database = getDatabase();
  ensureEmailTemplateShells(database, tenant);

  return (
    <section className="settings-content template-page sequence-page">
      <header className="settings-heading">
        <p className="eyebrow">Outreach</p>
        <h1>Sequences</h1>
        <p>{SEQUENCE_ENROLLMENT_COPY} Day 0 / 4 / 9 / 16 are offsets, not permission to send.</p>
      </header>
      <SequenceManager
        sequences={listSequences(database, tenant)}
        templates={listEmailTemplates(database, tenant).map((template) => ({
          id: template.id,
          title: template.title,
        }))}
      />
    </section>
  );
}

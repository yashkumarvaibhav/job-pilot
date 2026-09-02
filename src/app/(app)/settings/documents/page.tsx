import { DocumentManager } from "@/components/document-manager";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { documentResponse } from "@/server/repos/document-http";
import { listDocuments } from "@/server/repos/documents";

export default async function SettingsDocumentsPage() {
  const tenant = await requireTenant();
  const documents = listDocuments(getDatabase(), tenant).map(documentResponse);

  return (
    <section className="settings-screen">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Documents</h1>
          <p className="page-lede">
            Reusable resumes and other files. An application records exactly
            which version it used.
          </p>
        </div>
      </header>
      <DocumentManager documents={documents} />
    </section>
  );
}

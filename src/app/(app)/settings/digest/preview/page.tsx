import { MorningDigestPreview } from "@/components/morning-digest-preview";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { readDigestPreview } from "@/server/repos/digest";

export default async function DigestPreviewPage() {
  const tenant = await requireTenant();
  const preview = readDigestPreview(getDatabase(), tenant);

  return (
    <section className="settings-screen">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Morning digest preview</h1>
          <p className="page-lede">
            A deterministic list of what Today already counts. Emailing it is
            opt-in and always to the same connected Gmail address.
          </p>
        </div>
      </header>
      <MorningDigestPreview
        asOfOn={preview.asOfOn}
        body={preview.body}
        counts={preview.counts}
        timeZone={preview.timeZone}
      />
    </section>
  );
}

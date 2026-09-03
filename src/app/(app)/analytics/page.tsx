import { AnalyticsPanel } from "@/components/analytics-panel";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { getAnalyticsSnapshot } from "@/server/repos/analytics";

export default async function AnalyticsPage() {
  const tenant = await requireTenant();
  const snapshot = getAnalyticsSnapshot(getDatabase(), tenant);

  return (
    <section className="analytics-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Search health</p>
          <h1>Analytics</h1>
          <p className="page-lede">
            Funnel counts stay visible. Percentages wait until a step has five
            outcomes, so a small n cannot look like a precise rate.
          </p>
        </div>
      </header>
      <AnalyticsPanel snapshot={snapshot} />
    </section>
  );
}

import { QueueManager } from "@/components/queue-manager";
import { requireTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import { listOutreachQueue } from "@/server/repos/sequences";
import {
  listSuppressionEntries,
  queueAccountUsage,
} from "@/server/repos/send-safety";

export default async function QueuePage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ review?: string }>;
} = {}) {
  const tenant = await requireTenant();
  const database = getDatabase();
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  const review = (await searchParams).review;
  const items = listOutreachQueue(database, tenant).map((item) => ({
    ...item,
    sendAt: item.sendAt.toISOString(),
    sentAt: item.sentAt?.toISOString() ?? null,
  }));

  return (
    <section className="settings-content queue-page">
      <header className="settings-heading">
        <p className="eyebrow">Outreach safety</p>
        <h1>Send queue</h1>
        <p>
          Review one exact message at a time. Sequence rows never skip the mailbox
          check. Approved rows still stop at limits, weekday windows and suppression.
        </p>
      </header>
      <QueueManager
        initialReviewId={review}
        items={items}
        suppression={listSuppressionEntries(database, tenant).map((entry) => ({
          id: entry.id,
          email: entry.email,
          reason: entry.reason,
          at: entry.at.toISOString(),
        }))}
        timeZone={timeZone}
        usage={queueAccountUsage(database, tenant)}
      />
    </section>
  );
}

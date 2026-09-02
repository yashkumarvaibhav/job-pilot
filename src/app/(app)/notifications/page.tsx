import Link from "next/link";

import {
  NotificationCollection,
  NotificationMaterialize,
} from "@/components/notification-center";
import type { DueSourceKind } from "@/domain/due-source";
import {
  NOTIFICATION_EMPTY,
  NOTIFICATION_TABS,
} from "@/domain/notification";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  listNotifications,
  parseNotificationTab,
} from "@/server/repos/notifications";

type Props = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function NotificationsPage({ searchParams }: Props) {
  const tenant = await requireTenant();
  const params = await searchParams;
  const tab = parseNotificationTab(params.tab);
  const rows = listNotifications(getDatabase(), tenant, tab).map((row) => ({
    id: row.id,
    kind: row.kind as DueSourceKind,
    entityType: row.entityType,
    entityId: row.entityId,
    title: row.title,
    body: row.body,
    dueOn: row.dueOn,
    dueKey: row.dueKey,
    groupKey: row.groupKey,
  }));

  return (
    <section className="notification-page">
      <NotificationMaterialize />
      <header className="page-header">
        <div>
          <p className="eyebrow">Reminders without moving the date</p>
          <h1>Notifications</h1>
          <p className="page-lede">
            Snooze hides a reminder from Today. It does not change the follow-up
            you set on the person or the job.
          </p>
        </div>
      </header>
      <nav aria-label="Notification filters" className="filter-tabs">
        {NOTIFICATION_TABS.map((item) => (
          <Link
            aria-current={tab === item.key ? "page" : undefined}
            href={
              item.key === "unread"
                ? "/notifications"
                : `/notifications?tab=${item.key}`
            }
            key={item.key}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <NotificationCollection empty={NOTIFICATION_EMPTY} rows={rows} />
    </section>
  );
}

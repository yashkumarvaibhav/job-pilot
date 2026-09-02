import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { calendarDateInZone } from "@/domain/referral";
import { requireTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import { listCompanies } from "@/server/repos/companies";
import { listContacts } from "@/server/repos/contacts";
import { countUnreadNotifications } from "@/server/repos/notifications";
import { listOpportunities } from "@/server/repos/opportunities";

/**
 * The gate for every workspace screen. Authority comes from the session row
 * alone, so an unauthenticated request never reaches a data surface (D-035).
 */
export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const tenant = await requireTenant();
  const database = getDatabase();
  const timezone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  const quickAddData = {
    companies: listCompanies(database, tenant).map(({ id, name }) => ({
      id,
      name,
    })),
    contacts: listContacts(database, tenant).map(({ id, name }) => ({
      id,
      name,
    })),
    opportunities: listOpportunities(database, tenant, "all").map(
      ({ id, companyName, role }) => ({ id, companyName, role }),
    ),
    today: calendarDateInZone(timezone),
  };

  return (
    <AppShell
      quickAddData={quickAddData}
      unreadCount={countUnreadNotifications(database, tenant)}
    >
      {children}
    </AppShell>
  );
}

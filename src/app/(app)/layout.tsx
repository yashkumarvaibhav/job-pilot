import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { requireTenant } from "@/server/auth/current-session";

/**
 * The gate for every workspace screen. Authority comes from the session row
 * alone, so an unauthenticated request never reaches a data surface (D-035).
 */
export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireTenant();

  return <AppShell>{children}</AppShell>;
}

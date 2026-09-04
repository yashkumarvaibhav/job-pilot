import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { currentTenant } from "@/server/auth/current-session";

/**
 * Account access has no rail and stays at the comfortable density (UIUX.md).
 * A signed-in visitor has no business here, so send them to Today.
 */
export default async function AccountAccessLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (await currentTenant()) {
    redirect("/today");
  }

  return (
    <div className="auth-shell">
      <header className="auth-topbar">
        <span className="brand-lockup">
          <BrandMark />
          <span className="brand-wordmark">
            <strong>Job Pilot</strong>
          </span>
        </span>
        <ThemeToggle />
      </header>
      <main className="auth-main" id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

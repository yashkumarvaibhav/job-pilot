"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { railItems, routeIsActive } from "@/lib/navigation";
import { ThemeToggle } from "./theme-toggle";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link aria-label="Job Pilot home" className="brand-lockup" href="/">
          <span aria-hidden="true" className="brand-mark" />
          <span className="brand-wordmark">
            <strong>Job Pilot</strong>
            <small>Off-campus</small>
          </span>
        </Link>
        <ThemeToggle />
      </header>

      <aside className="rail">
        <nav aria-label="Primary navigation" className="rail-nav">
          {railItems.map((item) => {
            const active = routeIsActive(pathname, item.href);

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className="rail-link"
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main data-density="compact" id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

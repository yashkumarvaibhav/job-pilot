"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  mobileItems,
  mobileRouteIsActive,
  railItems,
  routeIsActive,
} from "@/lib/navigation";
import { SignOutButton } from "./sign-out-button";
import { ThemeToggle } from "./theme-toggle";

function MobileIcon({ icon }: { icon: (typeof mobileItems)[number]["icon"] }) {
  if (icon === "today") {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z" />
      </svg>
    );
  }

  if (icon === "contacts") {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-4 2-6 6-6s6 2 6 6M16 5a3 3 0 0 1 0 6M17 14c2.7.3 4 2.3 4 6" />
      </svg>
    );
  }

  if (icon === "opportunities") {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path d="M9 6V4h6v2M4 7h16v13H4zM4 12h16M10 12v2h4v-2" />
      </svg>
    );
  }

  if (icon === "add") {
    return (
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </svg>
  );
}

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
        <div className="topbar-actions">
          <Link
            aria-label="Notifications, 0 unread"
            className="notification-link"
            href="/notifications"
          >
            <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
            </svg>
            <span className="tnum">0</span>
          </Link>
          <ThemeToggle />
          <SignOutButton className="btn btn--ghost topbar-sign-out" />
        </div>
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

      <nav aria-label="Mobile navigation" className="mobile-nav">
        {mobileItems.map((item) => {
          const active = mobileRouteIsActive(pathname, item.href);

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className="mobile-link"
              href={item.href}
              key={item.href}
            >
              <MobileIcon icon={item.icon} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

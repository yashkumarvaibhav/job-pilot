"use client";

import {
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  FileCheck2,
  Handshake,
  Inbox,
  ListTodo,
  Settings,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  mobileItems,
  mobileRouteIsActive,
  railItems,
  routeIsActive,
} from "@/lib/navigation";
import { CommandPaletteHost } from "./command-palette-host";
import { SignOutButton } from "./sign-out-button";
import { BrandMark } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";
import { QuickAdd, type QuickAddAction, type QuickAddReferenceData } from "./quick-add";
import { QUICK_ADD_OPEN_EVENT } from "./quick-add-launch";

const railIcons: Record<(typeof railItems)[number]["icon"], LucideIcon> = {
  analytics: ChartNoAxesCombined,
  applications: FileCheck2,
  companies: Building2,
  contacts: UsersRound,
  inbox: Inbox,
  notifications: Bell,
  opportunities: BriefcaseBusiness,
  referrals: Handshake,
  settings: Settings,
  tasks: ListTodo,
  today: CalendarDays,
};

function RailIcon({ icon }: { icon: (typeof railItems)[number]["icon"] }) {
  const Icon = railIcons[icon];
  return <Icon aria-hidden="true" className="rail-icon" />;
}

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

export function AppShell({
  children,
  quickAddData,
  unreadCount = 0,
}: {
  children: ReactNode;
  quickAddData: QuickAddReferenceData;
  unreadCount?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [quickAddOpen, setQuickAddOpen] = useState(pathname === "/add");
  const [quickAddTrigger, setQuickAddTrigger] = useState<HTMLElement | null>(null);
  const [quickAddAction, setQuickAddAction] = useState<QuickAddAction | null>(null);

  const closeQuickAdd = useCallback(() => {
    setQuickAddOpen(false);
    setQuickAddAction(null);
    if (pathname === "/add") router.replace("/");
  }, [pathname, router]);

  function openQuickAdd(
    trigger: HTMLElement | null,
    action: QuickAddAction | null = null,
  ) {
    setQuickAddTrigger(trigger);
    setQuickAddAction(action);
    setQuickAddOpen(true);
  }

  useEffect(() => {
    function onOpenRequest() {
      openQuickAdd(
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      );
    }
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable);
      if (
        quickAddOpen ||
        typing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.key.toLowerCase() !== "c"
      ) return;
      event.preventDefault();
      openQuickAdd(
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      );
    }
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(QUICK_ADD_OPEN_EVENT, onOpenRequest);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(QUICK_ADD_OPEN_EVENT, onOpenRequest);
    };
  }, [quickAddOpen]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link aria-label="Job Pilot home" className="brand-lockup" href="/">
          <BrandMark />
          <span className="brand-wordmark">
            <strong>Job Pilot</strong>
          </span>
        </Link>
        <div className="topbar-actions">
          <CommandPaletteHost
            onQuickAdd={(action, trigger) => openQuickAdd(trigger, action)}
          />
          <button
            aria-expanded={quickAddOpen}
            aria-haspopup="dialog"
            className="btn quick-add-trigger"
            onClick={(event) => openQuickAdd(event.currentTarget)}
            type="button"
          >
            Add
          </button>
          <Link
            aria-label={`Notifications, ${unreadCount} unread`}
            className="notification-link"
            href="/notifications"
          >
            <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
            </svg>
            <span className="tnum">{unreadCount}</span>
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
                <RailIcon icon={item.icon} />
                <span>{item.label}</span>
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

          if (item.icon === "add") {
            return (
              <button
                aria-expanded={quickAddOpen}
                aria-haspopup="dialog"
                className="mobile-link"
                key={item.href}
                onClick={(event) => openQuickAdd(event.currentTarget)}
                type="button"
              >
                <MobileIcon icon={item.icon} />
                <span>{item.label}</span>
              </button>
            );
          }

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

      {quickAddOpen ? (
        <QuickAdd
          data={quickAddData}
          initialAction={quickAddAction}
          onClose={closeQuickAdd}
          returnFocusTo={quickAddTrigger}
        />
      ) : null}
    </div>
  );
}

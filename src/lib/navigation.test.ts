import { describe, expect, it } from "vitest";
import {
  mobileItems,
  mobileRouteIsActive,
  railItems,
  routeIsActive,
} from "./navigation";

describe("shell navigation", () => {
  it("keeps the authoritative rail names and routes in order", () => {
    expect(railItems).toEqual([
      { label: "Today", href: "/today", icon: "today" },
      { label: "Companies", href: "/companies", icon: "companies" },
      { label: "Contacts", href: "/contacts", icon: "contacts" },
      { label: "Opportunities", href: "/opportunities", icon: "opportunities" },
      { label: "Referrals", href: "/referrals", icon: "referrals" },
      { label: "Applications", href: "/applications", icon: "applications" },
      { label: "Tasks", href: "/tasks", icon: "tasks" },
      { label: "Inbox", href: "/inbox", icon: "inbox" },
      { label: "Notifications", href: "/notifications", icon: "notifications" },
      { label: "Analytics", href: "/analytics", icon: "analytics" },
      { label: "Settings", href: "/settings", icon: "settings" },
    ]);
  });

  it("marks entity descendants without treating every route as Today", () => {
    expect(routeIsActive("/today", "/today")).toBe(true);
    expect(routeIsActive("/contacts/person-1", "/contacts")).toBe(true);
    expect(routeIsActive("/contacts", "/today")).toBe(false);
  });

  it("keeps five mobile destinations and groups secondary routes under More", () => {
    expect(mobileItems.map(({ label }) => label)).toEqual([
      "Today",
      "Contacts",
      "Opportunities",
      "Add",
      "More",
    ]);
    expect(mobileRouteIsActive("/analytics", "/more")).toBe(true);
    expect(mobileRouteIsActive("/contacts/person-1", "/more")).toBe(false);
    expect(mobileRouteIsActive("/contacts/person-1", "/contacts")).toBe(true);
  });
});

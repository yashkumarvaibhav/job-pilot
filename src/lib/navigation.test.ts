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
      { label: "Today", href: "/" },
      { label: "Companies", href: "/companies" },
      { label: "Contacts", href: "/contacts" },
      { label: "Opportunities", href: "/opportunities" },
      { label: "Referrals", href: "/referrals" },
      { label: "Applications", href: "/applications" },
      { label: "Tasks", href: "/tasks" },
      { label: "Inbox", href: "/inbox" },
      { label: "Notifications", href: "/notifications" },
      { label: "Analytics", href: "/analytics" },
      { label: "Settings", href: "/settings" },
    ]);
  });

  it("marks entity descendants without treating every route as Today", () => {
    expect(routeIsActive("/", "/")).toBe(true);
    expect(routeIsActive("/contacts/person-1", "/contacts")).toBe(true);
    expect(routeIsActive("/contacts", "/")).toBe(false);
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

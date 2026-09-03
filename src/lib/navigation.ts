export const railItems = [
  { label: "Today", href: "/", icon: "today" },
  { label: "Companies", href: "/companies", icon: "companies" },
  { label: "Contacts", href: "/contacts", icon: "contacts" },
  {
    label: "Opportunities",
    href: "/opportunities",
    icon: "opportunities",
  },
  { label: "Referrals", href: "/referrals", icon: "referrals" },
  { label: "Applications", href: "/applications", icon: "applications" },
  { label: "Tasks", href: "/tasks", icon: "tasks" },
  { label: "Inbox", href: "/inbox", icon: "inbox" },
  {
    label: "Notifications",
    href: "/notifications",
    icon: "notifications",
  },
  { label: "Analytics", href: "/analytics", icon: "analytics" },
  { label: "Settings", href: "/settings", icon: "settings" },
] as const;

export const mobileItems = [
  { label: "Today", href: "/", icon: "today" },
  { label: "Contacts", href: "/contacts", icon: "contacts" },
  {
    label: "Opportunities",
    href: "/opportunities",
    icon: "opportunities",
  },
  { label: "Add", href: "/add", icon: "add" },
  { label: "More", href: "/more", icon: "more" },
] as const;

export function routeIsActive(pathname: string, href: string) {
  return href === "/"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function mobileRouteIsActive(pathname: string, href: string) {
  if (href !== "/more") {
    return routeIsActive(pathname, href);
  }

  return !mobileItems
    .filter((item) => item.href !== "/more")
    .some((item) => routeIsActive(pathname, item.href));
}

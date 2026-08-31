export const railItems = [
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
] as const;

export function routeIsActive(pathname: string, href: string) {
  return href === "/"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

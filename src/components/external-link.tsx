import { ExternalLink as ExternalLinkIcon } from "lucide-react";

import { canonicalHttpUrl } from "@/domain/web-url";

export function SafeExternalLink({
  className = "table-link",
  href,
  label,
}: {
  className?: string;
  href: string;
  label: string;
}) {
  const safeHref = canonicalHttpUrl(href);
  if (!safeHref) return null;

  return (
    <a
      aria-label={`${label} in a new tab`}
      className={className}
      href={safeHref}
      rel="noopener noreferrer"
      target="_blank"
    >
      {label}
      <ExternalLinkIcon aria-hidden="true" />
    </a>
  );
}

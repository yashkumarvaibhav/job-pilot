import { ExternalLink as ExternalLinkIcon } from "lucide-react";

import { PreviewLink } from "./record-preview";

import { canonicalHttpUrl } from "@/domain/web-url";

export function SafeExternalLink({
  className = "table-link",
  href,
  label,
  preview = true,
}: {
  className?: string;
  href: string;
  label: string;
  preview?: boolean;
}) {
  const safeHref = canonicalHttpUrl(href);
  if (!safeHref) return null;

  return (
    <PreviewLink preview={preview}
      aria-label={preview ? `Preview ${label}` : `${label} in a new tab`}
      className={className}
      href={safeHref}
      rel="noopener noreferrer"
      target="_blank"
    >
      {label}
      <ExternalLinkIcon aria-hidden="true" />
    </PreviewLink>
  );
}

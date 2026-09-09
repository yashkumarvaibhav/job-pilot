import type { ContactMethodKind } from "@/domain/contact";
import { canonicalHttpUrl } from "@/domain/web-url";
import { SafeExternalLink } from "./external-link";

export function ContactMethodValue({
  kind,
  value,
}: {
  kind: ContactMethodKind;
  value: string;
}) {
  const href =
    kind === "linkedin" || kind === "other" ? canonicalHttpUrl(value) : null;

  if (!href) return <strong>{value}</strong>;
  return (
    <SafeExternalLink
      className="table-link contact-method-link"
      href={href}
      label={kind === "linkedin" ? "Open LinkedIn profile" : "Open external profile"}
    />
  );
}

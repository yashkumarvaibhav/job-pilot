import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { canonicalHttpUrl } from "@/domain/web-url";

/** One labelled fact — the card's replacement for a table column (D-064). */
export type RecordFact = { label: string; value: ReactNode };

/**
 * Somewhere the record can be opened. `href: null` means the record has no such
 * destination saved, which renders as a disabled control naming what is missing
 * rather than a dead link or a silently absent one.
 */
export type RecordDestination = {
  key: string;
  label: string;
  missingLabel: string;
  href: string | null;
  icon: ReactNode;
  /** External destinations open in a new tab; internal ones navigate normally. */
  external?: boolean;
};

/** A Gmail compose window addressed to one recipient. Composing is not sending. */
export function gmailComposeUrl(address: string | null): string | null {
  const trimmed = address?.trim();
  if (!trimmed) return null;
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(trimmed)}`;
}

export function RecordCards({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <ul aria-label={label} className="record-cards">
      {children}
    </ul>
  );
}

export function RecordCard({
  chips,
  destinations,
  facts,
  heading,
  status,
  subtitle,
}: {
  chips?: ReactNode;
  destinations: RecordDestination[];
  facts: RecordFact[];
  heading: ReactNode;
  status?: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <li className="record-card">
      <div className="record-card__head">
        <div className="record-card__identity">
          {/* A heading per record, so the list is navigable by heading as well
              as by list item. The card itself is never a link: its footer holds
              real ones, and an anchor cannot contain another. */}
          <h2 className="record-card__name">{heading}</h2>
          {subtitle ? <p className="record-card__subtitle">{subtitle}</p> : null}
        </div>
        {status}
      </div>
      <dl className="record-card__facts">
        {facts.map((fact) => (
          <div className="record-card__fact" key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {chips ? <div className="record-card__chips">{chips}</div> : null}
      {destinations.length > 0 ? (
        <div className="record-card__foot">
          {destinations.map(({ key, ...destination }) => (
            <RecordDestinationControl key={key} {...destination} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

function RecordDestinationControl({
  external = true,
  href,
  icon,
  label,
  missingLabel,
}: Omit<RecordDestination, "key">) {
  const safeHref = external && href ? canonicalHttpUrl(href) : href;

  if (!safeHref) {
    return (
      <button className="record-action" disabled type="button">
        {icon}
        {missingLabel}
      </button>
    );
  }

  if (!external) {
    return (
      <Link className="record-action" href={safeHref}>
        {icon}
        {label}
      </Link>
    );
  }

  return (
    <a
      aria-label={`${label} in a new tab`}
      className="record-action"
      href={safeHref}
      rel="noopener noreferrer"
      target="_blank"
    >
      {icon}
      {label}
      <ExternalLinkIcon aria-hidden="true" className="record-action__external" />
    </a>
  );
}

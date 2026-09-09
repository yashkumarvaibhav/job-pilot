import { SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * One filter that the current URL is actually applying. `clearHref` is the same
 * view with this one parameter dropped, so removing a filter never resets the
 * others — the behaviour six permanently expanded selects used to hide.
 */
export type AppliedFilter = {
  key: string;
  label: string;
  value: string;
  clearHref: string;
};

/**
 * The single control region above a record list (D-063). The filter fields live
 * inside a native `<details>` so the closed state costs no height and needs no
 * JavaScript; what is applied is stated outside it, where it stays readable.
 */
export function ListToolbar({
  applied,
  children,
  clearAllHref,
  countLabel,
  filterFormLabel,
  savedSearches,
  tabs,
}: {
  applied: AppliedFilter[];
  children: ReactNode;
  clearAllHref: string;
  countLabel: string;
  filterFormLabel: string;
  savedSearches?: ReactNode;
  tabs?: ReactNode;
}) {
  // Saved views sit in the control row beside the tabs: they select a view just
  // as the tabs do, and a permanent second row for them was half the height the
  // toolbar was meant to give back (D-063).
  return (
    <div className="list-toolbar">
      <div className="list-toolbar__bar">
        {tabs}
        <details className="list-toolbar__filters">
          <summary className="list-toolbar__summary">
            <SlidersHorizontal aria-hidden="true" />
            Filters
            {applied.length > 0 ? (
              <span className="list-toolbar__badge">
                {applied.length} applied
              </span>
            ) : null}
          </summary>
          <div className="list-toolbar__panel">{children}</div>
        </details>
        {savedSearches}
        <p className="list-toolbar__count">{countLabel}</p>
      </div>
      {applied.length > 0 ? (
        <ul
          aria-label={`Applied ${filterFormLabel} filters`}
          className="list-toolbar__applied"
        >
          {applied.map((item) => (
            <li key={item.key}>
              <Link
                aria-label={`Remove the ${item.label} filter ${item.value}`}
                className="filter-chip"
                href={item.clearHref}
              >
                <span className="filter-chip__label">{item.label}</span>
                <span className="filter-chip__value">{item.value}</span>
                <X aria-hidden="true" />
              </Link>
            </li>
          ))}
          <li>
            <Link className="filter-chip filter-chip--clear" href={clearAllHref}>
              Clear all
            </Link>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

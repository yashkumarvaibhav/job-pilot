import { AlertTriangle } from "lucide-react";

import type { StaleMark } from "@/domain/rules";

export function StaleFlag({ reasons }: { reasons: readonly StaleMark[] }) {
  if (reasons.length === 0) {
    return null;
  }

  return (
    <div className="stale-flag">
      <span className="chip contact-status-chip" data-tone="warning">
        <AlertTriangle aria-hidden="true" />
        Stale
      </span>
      <ul aria-label="Stale reasons" className="stale-flag__reasons">
        {reasons.map((mark) => (
          <li key={`${mark.entityType}:${mark.entityId}:${mark.slug}`}>
            {mark.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

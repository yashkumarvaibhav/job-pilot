"use client";

import {
  duplicateSignalLabel,
  type DuplicateConflict,
} from "@/domain/duplicate";

type Props = {
  conflict: DuplicateConflict;
  pending?: boolean;
  onCreateAnyway: () => void;
};

export function DuplicateWarning({
  conflict,
  pending = false,
  onCreateAnyway,
}: Props) {
  return (
    <aside className="duplicate-warning" role="alert">
      <span className="chip chip--status" data-status="degraded">
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path
            d="M12 3 22 21H2L12 3Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="2"
          />
          <path d="M12 10v5" stroke="currentColor" strokeWidth="2" />
          <circle cx="12" cy="18" fill="currentColor" r="1.25" />
        </svg>
        Possible duplicate
      </span>
      <p>{conflict.error}</p>
      <ul>
        {conflict.candidates.map((candidate) => (
          <li key={candidate.id}>
            <a href={candidate.href}>{candidate.label}</a>
            <span>
              {candidate.signals
                .map((signal) => duplicateSignalLabel(signal))
                .join("; ")}
            </span>
          </li>
        ))}
      </ul>
      <button
        className="btn"
        disabled={pending}
        onClick={onCreateAnyway}
        type="button"
      >
        {pending ? "Saving…" : "Create anyway"}
      </button>
    </aside>
  );
}

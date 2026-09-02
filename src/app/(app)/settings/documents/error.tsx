"use client";

import { DOCUMENT_ERROR } from "@/domain/document";

export default function DocumentsError({ reset }: { reset: () => void }) {
  return (
    <section className="data-state data-state--error">
      <p className="eyebrow">Could not load</p>
      <h1>Documents are unavailable</h1>
      <p>{DOCUMENT_ERROR}</p>
      <button className="btn btn--ghost" onClick={reset} type="button">
        Retry
      </button>
    </section>
  );
}

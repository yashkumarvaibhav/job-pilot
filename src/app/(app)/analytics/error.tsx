"use client";

import { ANALYTICS_ERROR } from "@/domain/analytics";

export default function AnalyticsError({
  reset,
}: {
  reset: () => void;
}) {
  return (
    <section className="data-state data-state--error" role="alert">
      <p className="eyebrow">Could not load</p>
      <h1>Analytics are unavailable</h1>
      <p>{ANALYTICS_ERROR}</p>
      <button className="btn btn--ghost" onClick={reset} type="button">
        Retry
      </button>
    </section>
  );
}

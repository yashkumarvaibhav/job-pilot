"use client";

import { TODAY_ERROR } from "@/domain/today";

export default function TodayError({ reset }: { reset: () => void }) {
  return (
    <section className="data-state data-state--error" role="alert">
      <p className="eyebrow">{TODAY_ERROR}</p>
      <h1>Today is unavailable</h1>
      <p>Retry the request. Your saved records have not been changed.</p>
      <button className="btn btn--ghost" onClick={reset} type="button">
        Retry
      </button>
    </section>
  );
}

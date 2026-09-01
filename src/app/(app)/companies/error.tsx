"use client";

export default function CompaniesError({ reset }: { reset: () => void }) {
  return (
    <section className="data-state data-state--error" role="alert">
      <p className="eyebrow">Could not load companies</p>
      <h1>Company data is unavailable</h1>
      <p>Retry the request. Your saved company records have not been changed.</p>
      <button className="btn btn--ghost" onClick={reset} type="button">
        Retry
      </button>
    </section>
  );
}

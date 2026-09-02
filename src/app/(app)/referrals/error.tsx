"use client";

export default function ReferralsError({
  reset,
}: {
  reset: () => void;
}) {
  return (
    <section className="data-state data-state--error" role="alert">
      <p className="eyebrow">Could not load</p>
      <h1>Referrals are unavailable</h1>
      <p>Job Pilot could not read this workspace. Retry the request.</p>
      <button className="btn btn--ghost" onClick={reset} type="button">
        Retry
      </button>
    </section>
  );
}

"use client";

export default function InboxError({ reset }: { reset: () => void }) {
  return (
    <section className="data-state data-state--error" role="alert">
      <p className="eyebrow">Inbox unavailable</p>
      <h1>Job Inbox could not load</h1>
      <p>Your Gmail accounts were not changed.</p>
      <button className="btn" onClick={reset} type="button">
        Retry
      </button>
    </section>
  );
}

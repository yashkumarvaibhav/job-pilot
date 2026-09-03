"use client";

export default function ComposeError({ reset }: { reset: () => void }) {
  return (
    <section className="data-state data-state--error" role="alert">
      <p className="eyebrow">Composer unavailable</p>
      <h1>Could not load the composer</h1>
      <p>Retry without leaving your workspace.</p>
      <button className="btn" onClick={reset} type="button">Retry</button>
    </section>
  );
}

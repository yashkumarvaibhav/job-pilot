"use client";

export default function SequencesError({ reset }: { reset: () => void }) {
  return (
    <section className="data-state data-state--error" role="alert">
      <h1>Could not load sequences</h1>
      <p>Retry without leaving your workspace.</p>
      <button className="btn" onClick={reset} type="button">Retry</button>
    </section>
  );
}

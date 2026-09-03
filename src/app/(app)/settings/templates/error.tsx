"use client";

export default function TemplatesError({ reset }: { reset: () => void }) {
  return (
    <section className="data-state data-state--error" role="alert">
      <h1>Could not load email templates</h1>
      <p>Retry without leaving your workspace.</p>
      <button className="btn" onClick={reset} type="button">Retry</button>
    </section>
  );
}

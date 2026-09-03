"use client";

export default function QueueError({ reset }: { reset: () => void }) {
  return (
    <section className="settings-content queue-page">
      <div className="data-state data-state--error" role="alert">
        <h1>Send queue unavailable</h1>
        <p>No approval or send action was performed. Retry when the workspace is reachable.</p>
        <button className="btn btn--ghost" onClick={reset} type="button">Retry queue</button>
      </div>
    </section>
  );
}

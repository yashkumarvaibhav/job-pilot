"use client";

export default function NotificationsError({
  reset,
}: {
  reset: () => void;
}) {
  return (
    <section className="data-state data-state--error" role="alert">
      <p className="eyebrow">Could not load</p>
      <h1>Notifications are unavailable</h1>
      <p>Could not load notifications</p>
      <button className="btn btn--ghost" onClick={reset} type="button">
        Retry
      </button>
    </section>
  );
}

"use client";

export default function ContactsError({ reset }: { reset: () => void }) {
  return (
    <section className="data-state data-state--error">
      <p className="eyebrow">Could not load contacts</p>
      <h1>Contacts are unavailable</h1>
      <p>Retry the local database request. No contact data was changed.</p>
      <button className="btn btn--ghost" onClick={reset} type="button">
        Retry
      </button>
    </section>
  );
}

export default function SequencesLoading() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading sequences"
      className="data-state"
      role="status"
    >
      <h1>Loading sequences…</h1>
      <p>Your approval-gated follow-up sequences are loading.</p>
    </section>
  );
}

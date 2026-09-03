export default function ComposeLoading() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading email composer"
      className="data-state"
      role="status"
    >
      <p className="eyebrow">Gmail</p>
      <h1>Loading composer…</h1>
      <p>Your connected accounts and owner-written templates are loading.</p>
    </section>
  );
}

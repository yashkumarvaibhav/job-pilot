export default function TemplatesLoading() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading email templates"
      className="data-state"
      role="status"
    >
      <h1>Loading email templates…</h1>
      <p>Your owner-written template library is loading.</p>
    </section>
  );
}

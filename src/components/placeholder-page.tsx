export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="placeholder-page">
      <p className="eyebrow">Coming later</p>
      <h1>{title}</h1>
      <div className="placeholder-card">
        <p>This screen is not built yet.</p>
      </div>
    </section>
  );
}

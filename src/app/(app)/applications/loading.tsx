export default function ApplicationsLoading() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading applications"
      className="application-page"
    >
      <div className="skeleton skeleton-heading" />
      <div className="skeleton-table">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="skeleton skeleton-row" key={index} />
        ))}
      </div>
    </section>
  );
}

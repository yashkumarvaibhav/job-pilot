export default function CompaniesLoading() {
  return (
    <section aria-busy="true" aria-label="Loading companies" className="company-page">
      <div className="skeleton skeleton-heading" />
      <div className="card skeleton-table">
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
        <div className="skeleton skeleton-row" />
      </div>
    </section>
  );
}

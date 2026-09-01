export default function TodayLoading() {
  return (
    <section aria-busy="true" aria-label="Loading Today" className="today-page">
      <div className="skeleton skeleton-heading" />
      <div className="tiles today-stat-tiles">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="tile" key={index}>
            <div className="skeleton skeleton-row" />
          </div>
        ))}
      </div>
      <div className="skeleton-table">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="skeleton skeleton-row" key={index} />
        ))}
      </div>
    </section>
  );
}

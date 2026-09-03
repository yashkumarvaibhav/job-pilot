import { ANALYTICS_LOADING } from "@/domain/analytics";

export default function AnalyticsLoading() {
  return (
    <section
      aria-busy="true"
      aria-label={ANALYTICS_LOADING}
      className="analytics-page"
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

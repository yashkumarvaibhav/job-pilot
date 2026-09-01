export default function OpportunitiesLoading() {
  return <section aria-label="Loading opportunities" className="opportunity-page"><div className="skeleton skeleton-heading" /><div className="skeleton-table">{Array.from({ length: 4 }, (_, index) => <div className="skeleton skeleton-row" key={index} />)}</div></section>;
}

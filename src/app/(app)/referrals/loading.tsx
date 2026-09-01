export default function ReferralsLoading() {
  return (
    <section aria-label="Loading referrals" className="referral-page">
      <div className="skeleton skeleton-heading" />
      <div className="skeleton-table">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="skeleton skeleton-row" key={index} />
        ))}
      </div>
    </section>
  );
}

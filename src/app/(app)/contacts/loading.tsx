export default function ContactsLoading() {
  return (
    <section aria-label="Loading contacts" className="contact-page">
      <div className="skeleton skeleton-heading" />
      <div className="skeleton-table">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="skeleton skeleton-row" key={index} />
        ))}
      </div>
    </section>
  );
}

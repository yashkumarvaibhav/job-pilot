import { DOCUMENT_LOADING } from "@/domain/document";

export default function DocumentsLoading() {
  return (
    <section aria-busy="true" aria-label={DOCUMENT_LOADING} className="settings-screen">
      <div className="skeleton skeleton-heading" />
      <div className="skeleton-table">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="skeleton skeleton-row" key={index} />
        ))}
      </div>
    </section>
  );
}

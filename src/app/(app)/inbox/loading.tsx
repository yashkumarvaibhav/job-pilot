export default function InboxLoading() {
  return (
    <section aria-busy="true" aria-label="Loading Job Inbox" className="data-state">
      <p className="eyebrow">Gmail</p>
      <h1>Loading Job Inbox…</h1>
      <p>Reading account-scoped thread metadata.</p>
    </section>
  );
}

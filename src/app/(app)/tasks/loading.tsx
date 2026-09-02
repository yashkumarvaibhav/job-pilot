export default function TasksLoading() {
  return (
    <section aria-busy="true" aria-label="Loading tasks" className="task-page">
      <div className="skeleton skeleton-heading" />
      <div className="skeleton-table">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="skeleton skeleton-row" key={index} />
        ))}
      </div>
    </section>
  );
}

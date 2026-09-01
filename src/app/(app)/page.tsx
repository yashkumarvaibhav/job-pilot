import { DueItemCollection } from "@/components/due-list";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { listDueItems } from "@/server/repos/tasks";

export default async function Home() {
  const tenant = await requireTenant();
  const items = listDueItems(getDatabase(), tenant);

  return (
    <section className="task-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">What should I do?</p>
          <h1>Today</h1>
          <p className="page-lede">
            Next actions and open tasks in this workspace. Pipeline tiles land
            with the rest of Today.
          </p>
        </div>
      </header>
      <section aria-labelledby="do-now">
        <h2 id="do-now">Do Now</h2>
        <DueItemCollection rows={items} />
      </section>
    </section>
  );
}

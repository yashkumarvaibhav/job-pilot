import Link from "next/link";

import { TaskCreateForm } from "@/components/task-forms";
import { TaskCollection } from "@/components/task-list";
import { calendarDateInZone } from "@/domain/referral";
import { requireTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import { listCompanies } from "@/server/repos/companies";
import { listContacts } from "@/server/repos/contacts";
import { listOpportunities } from "@/server/repos/opportunities";
import { listReferrals } from "@/server/repos/referrals";
import { listTasks, parseTaskListFilter } from "@/server/repos/tasks";

type Props = {
  searchParams: Promise<{ status?: string; due?: string }>;
};

export default async function TasksPage({ searchParams }: Props) {
  const tenant = await requireTenant();
  const database = getDatabase();
  const params = await searchParams;
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  const asOfOn = calendarDateInZone(timeZone);
  const query = new URLSearchParams(
    Object.entries(params).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const filter = parseTaskListFilter(query, asOfOn);
  const status = filter.status ?? "open";
  const due = filter.due;
  const tasks = listTasks(database, tenant, filter);
  const contacts = listContacts(database, tenant).map((row) => ({
    id: row.id,
    label: row.name,
  }));
  const companies = listCompanies(database, tenant).map((row) => ({
    id: row.id,
    label: row.name,
  }));
  const opportunities = listOpportunities(database, tenant, "all").map(
    (row) => ({
      id: row.id,
      label: `${row.companyName} ${row.role}`,
    }),
  );
  const referrals = listReferrals(database, tenant, { asOfOn }).map((row) => ({
    id: row.id,
    label: row.role
      ? `${row.contactName} · ${row.role}`
      : row.contactName,
  }));
  const tabs = [
    { href: "/tasks", label: "Open", current: status === "open" && !due },
    {
      href: "/tasks?due=overdue",
      label: "Overdue",
      current: due === "overdue",
    },
    { href: "/tasks?due=today", label: "Today", current: due === "today" },
    { href: "/tasks?due=later", label: "Later", current: due === "later" },
    {
      href: "/tasks?status=completed",
      label: "Completed",
      current: status === "completed",
    },
  ];

  return (
    <section className="task-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Do the next thing</p>
          <h1>Tasks</h1>
          <p className="page-lede">
            Manual work sits here. Follow-up dates on contacts also appear on
            Today.
          </p>
        </div>
      </header>
      <nav aria-label="Task filters" className="filter-tabs">
        {tabs.map((tab) => (
          <Link
            aria-current={tab.current ? "page" : undefined}
            href={tab.href}
            key={tab.href}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <TaskCollection
        empty={
          status === "completed"
            ? "No completed tasks yet."
            : "No open tasks. Follow-up dates on contacts also appear on Today."
        }
        rows={tasks}
      />
      <section aria-labelledby="add-task" className="detail-section">
        <h2 id="add-task">Add task</h2>
        <TaskCreateForm
          links={{
            company: companies,
            contact: contacts,
            opportunity: opportunities,
            application: [],
            referral: referrals,
          }}
        />
      </section>
    </section>
  );
}

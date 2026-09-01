import { ActivityTimeline } from "@/components/activity-timeline";
import { calendarDateInZone } from "@/domain/referral";
import { requireTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import { listActivity, parseActivityListFilter } from "@/server/repos/activity";

type Props = { searchParams: Promise<{ on?: string }> };

export default async function SettingsActivityPage({ searchParams }: Props) {
  const tenant = await requireTenant();
  const database = getDatabase();
  const params = await searchParams;
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  const todayOn = calendarDateInZone(timeZone);
  const filter = parseActivityListFilter(
    new URLSearchParams(
      Object.entries(params).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    timeZone,
  );
  const items = listActivity(database, tenant, filter);

  return (
    <section className="activity-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Activity</h1>
          <p className="page-lede">
            Every saved change in this workspace, newest first.
          </p>
        </div>
      </header>
      <form className="activity-day-filter" method="get">
        <div className="field">
          <label htmlFor="activity-on">Day</label>
          <input
            className="tnum"
            defaultValue={filter.on ?? ""}
            id="activity-on"
            name="on"
            type="date"
          />
        </div>
        <button className="btn" type="submit">
          Show day
        </button>
        {filter.on ? (
          <a className="btn btn--ghost" href="/settings/activity">
            All days
          </a>
        ) : null}
      </form>
      <ActivityTimeline
        empty="No activity recorded yet."
        items={items}
        timeZone={timeZone}
        todayOn={todayOn}
      />
    </section>
  );
}

import { ActivityTimeline } from "@/components/activity-timeline";
import { TotpSkippedWarning } from "@/components/account-security";
import { DueItemCollection } from "@/components/due-list";
import {
  TODAY_EMPTY,
  TODAY_PIPELINE_TILES,
  TODAY_STAT_TILES,
} from "@/domain/today";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { getTodaySnapshot } from "@/server/repos/today";

export default async function TodayPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ totp?: string }>;
} = {}) {
  const tenant = await requireTenant();
  const snapshot = getTodaySnapshot(getDatabase(), tenant);
  const showTotpWarning = (await searchParams).totp === "skipped";

  return (
    <section className="today-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">What should I do?</p>
          <h1>Today</h1>
          <p className="page-lede">
            Counts for <span className="tnum">{snapshot.asOfOn}</span> in this
            workspace. n is a count, not a rate.
          </p>
        </div>
      </header>

      {showTotpWarning ? <TotpSkippedWarning /> : null}

      <div className="tiles today-stat-tiles">
        {TODAY_STAT_TILES.map((tile) => (
          <div className="tile" key={tile.key}>
            <span className="eyebrow">{tile.label}</span>
            <strong className="tnum">{snapshot.stats[tile.key]}</strong>
          </div>
        ))}
      </div>

      <section aria-labelledby="do-now">
        <h2 id="do-now">Do Now</h2>
        <DueItemCollection
          asOfOn={snapshot.asOfOn}
          empty={TODAY_EMPTY}
          rows={snapshot.doNow}
        />
      </section>

      <section aria-labelledby="pipeline">
        <h2 id="pipeline">Pipeline</h2>
        <div className="tiles pipeline-tiles">
          {TODAY_PIPELINE_TILES.map((tile) => (
            <div className="tile" key={tile.key}>
              <span className="eyebrow">{tile.label}</span>
              <strong className="tnum">{snapshot.pipeline[tile.key]}</strong>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="recent-activity">
        <h2 id="recent-activity">Recent activity</h2>
        <ActivityTimeline
          empty="No activity recorded yet."
          items={snapshot.activity}
          timeZone={snapshot.timeZone}
          todayOn={snapshot.asOfOn}
        />
      </section>
    </section>
  );
}

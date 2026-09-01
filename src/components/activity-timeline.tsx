import {
  activityDayHeading,
  formatActivityTime,
} from "@/domain/activity";
import type { ActivityFeedItem } from "@/server/repos/activity";

export function ActivityTimeline({
  empty,
  items,
  timeZone,
  todayOn,
}: {
  empty: string;
  items: ActivityFeedItem[];
  timeZone: string;
  todayOn: string;
}) {
  if (items.length === 0) {
    return <p className="section-empty">{empty}</p>;
  }

  const groups: { day: string; items: ActivityFeedItem[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.day === item.day) {
      last.items.push(item);
    } else {
      groups.push({ day: item.day, items: [item] });
    }
  }

  return (
    <div className="activity-feed">
      {groups.map((group) => (
        <section
          aria-labelledby={`activity-${group.day}`}
          className="activity-day"
          key={group.day}
        >
          <h3 className="activity-day__heading" id={`activity-${group.day}`}>
            {activityDayHeading(group.day, todayOn)}
          </h3>
          <ol className="activity-timeline">
            {group.items.map((item) => (
              <li key={item.id}>
                <time
                  className="tnum"
                  dateTime={item.at.toISOString()}
                >
                  {formatActivityTime(item.at, timeZone)}
                </time>
                <p>{item.headline}</p>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

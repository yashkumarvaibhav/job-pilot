import { activityResponse } from "./activity-http";
import type { TodaySnapshot } from "./today";

export function todayResponse(snapshot: TodaySnapshot) {
  return {
    asOfOn: snapshot.asOfOn,
    timeZone: snapshot.timeZone,
    stats: snapshot.stats,
    doNow: snapshot.doNow.map((row) => ({
      sourceKey: row.sourceKey,
      origin: row.origin,
      verb: row.verb,
      title: row.title,
      dueOn: row.dueOn,
      entityType: row.entityType,
      entityId: row.entityId,
      entityLabel: row.entityLabel,
      taskId: row.taskId,
    })),
    pipeline: snapshot.pipeline,
    activity: snapshot.activity.map(activityResponse),
  };
}

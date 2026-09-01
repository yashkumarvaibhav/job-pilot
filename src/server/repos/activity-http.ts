import type { ActivityFeedItem } from "./activity";

export function activityResponse(item: ActivityFeedItem) {
  return {
    id: item.id,
    at: item.at.toISOString(),
    kind: item.kind,
    entityType: item.entityType,
    entityId: item.entityId,
    headline: item.headline,
    day: item.day,
  };
}

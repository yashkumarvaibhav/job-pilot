import type { AnalyticsSnapshot } from "./analytics";

export function analyticsResponse(snapshot: AnalyticsSnapshot) {
  return {
    empty: snapshot.empty,
    emptyCopy: snapshot.emptyCopy,
    funnel: snapshot.funnel.map((step) => ({
      key: step.key,
      label: step.label,
      count: step.count,
      rate: {
        percent: step.rate.percent,
        label: step.rate.label,
        suppressed: step.rate.suppressed,
        denominator: step.rate.denominator,
      },
    })),
    slices: snapshot.slices.map((column) => ({
      key: column.key,
      label: column.label,
      applications: column.applications,
      interviews: column.interviews,
      rate: {
        percent: column.rate.percent,
        label: column.rate.label,
        suppressed: column.rate.suppressed,
        denominator: column.rate.denominator,
      },
    })),
    channels: snapshot.channels.map((row) => ({
      channel: row.channel,
      label: row.label,
      attempts: row.attempts,
      replies: row.replies,
      referrals: row.referrals,
    })),
  };
}

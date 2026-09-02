import { and, eq, isNull } from "drizzle-orm";

import {
  calendarDateInZone,
  isReferralTerminalStage,
} from "../../domain/referral";
import { parseDueSourceKey, isDeadlineObjectKind } from "../../domain/due-source";
import {
  TODAY_ACTIVITY_LIMIT,
  isDueOnOrBefore,
  todayDoNowVerbForKey,
  todayOpportunityPipelineTile,
} from "../../domain/today";
import { isDueInsideHorizon } from "../../domain/assessment";
import { getWorkspaceSettings } from "../db/foundation";
import type { AppDatabase } from "../db/client";
import { interaction } from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { DEFAULT_TIME_ZONE } from "../db/timezone";
import { listActivity, type ActivityFeedItem } from "./activity";
import { countInterviewsOn } from "./interviews";
import { listSnoozedDueKeys } from "./notifications";
import { listOpportunities } from "./opportunities";
import { listReferrals } from "./referrals";
import { listDueItems, type DueItem } from "./tasks";

export type TodayDoNowRow = DueItem & { verb: string };

export type TodayStats = {
  followUps: number;
  needReply: number;
  deadlines: number;
  interviewsToday: number;
};

export type TodayPipeline = {
  saved: number;
  referral: number;
  applied: number;
  oa: number;
  interview: number;
  offer: number;
};

export type TodaySnapshot = {
  asOfOn: string;
  timeZone: string;
  stats: TodayStats;
  doNow: TodayDoNowRow[];
  pipeline: TodayPipeline;
  activity: ActivityFeedItem[];
};

export function listTodayDueItems(
  database: AppDatabase,
  tenant: TenantContext,
  asOfOn: string,
  now: Date = new Date(),
): DueItem[] {
  const snoozed = listSnoozedDueKeys(database, tenant, now);
  return listDueItems(database, tenant).filter((item) => {
    if (snoozed.has(item.sourceKey)) {
      return false;
    }
    const kind = parseDueSourceKey(item.sourceKey)?.kind;
    if (kind && isDeadlineObjectKind(kind)) {
      return isDueInsideHorizon(item.dueOn, asOfOn);
    }
    return isDueOnOrBefore(item.dueOn, asOfOn);
  });
}

function emptyPipeline(): TodayPipeline {
  return {
    saved: 0,
    referral: 0,
    applied: 0,
    oa: 0,
    interview: 0,
    offer: 0,
  };
}

export function getTodaySnapshot(
  database: AppDatabase,
  tenant: TenantContext,
  options: { now?: Date } = {},
): TodaySnapshot {
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  const now = options.now ?? new Date();
  const asOfOn = calendarDateInZone(timeZone, now);

  const doNow = listTodayDueItems(database, tenant, asOfOn, now).map(
    (item) => ({
      ...item,
      verb: todayDoNowVerbForKey(item.sourceKey),
    }),
  );

  const pipeline = emptyPipeline();
  let deadlines = 0;
  for (const row of listOpportunities(database, tenant, "all")) {
    const tile = todayOpportunityPipelineTile(
      row.stage,
      row.application?.stage,
    );
    if (tile) {
      pipeline[tile] += 1;
    }
    if (tile && isDueOnOrBefore(row.deadlineOn, asOfOn)) {
      deadlines += 1;
    }
  }

  for (const item of doNow) {
    const kind = parseDueSourceKey(item.sourceKey)?.kind;
    if (kind && isDeadlineObjectKind(kind)) {
      deadlines += 1;
    }
  }

  for (const row of listReferrals(database, tenant, { asOfOn })) {
    if (!isReferralTerminalStage(row.stage)) {
      pipeline.referral += 1;
    }
  }

  const needReply = database
    .select({ id: interaction.id })
    .from(interaction)
    .where(
      and(
        eq(interaction.workspaceId, tenant.workspaceId),
        eq(interaction.direction, "inbound"),
        eq(interaction.requiresReply, true),
        isNull(interaction.replyResolvedAt),
      ),
    )
    .all().length;

  const activity = listActivity(database, tenant, { timeZone }).slice(
    0,
    TODAY_ACTIVITY_LIMIT,
  );

  return {
    asOfOn,
    timeZone,
    stats: {
      followUps: doNow.filter((item) => {
        const kind = parseDueSourceKey(item.sourceKey)?.kind;
        return (
          item.origin === "derived" &&
          kind !== "interview" &&
          (kind == null || !isDeadlineObjectKind(kind))
        );
      }).length,
      needReply,
      deadlines,
      interviewsToday: countInterviewsOn(database, tenant, asOfOn, timeZone),
    },
    doNow,
    pipeline,
    activity,
  };
}

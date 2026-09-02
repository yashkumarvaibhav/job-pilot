import { randomUUID } from "node:crypto";

import { and, asc, eq, gt, inArray, isNotNull } from "drizzle-orm";

import {
  dueSourceKey,
  parseDueSourceKey,
  type DueSourceKind,
} from "../../domain/due-source";
import {
  isNotificationTab,
  isSnoozePreset,
  notificationGroupKey,
  matchesNotificationTab,
  requestForbidsNotificationWrites,
  snoozeUntil,
  startOfZonedDay,
  type NotificationTab,
  type SnoozePreset,
} from "../../domain/notification";
import { OPPORTUNITY_TERMINAL_STAGES } from "../../domain/opportunity";
import {
  todayDoNowHeading,
  todayDoNowVerbForKey,
} from "../../domain/today";
import { getWorkspaceSettings } from "../db/foundation";
import type { AppDatabase, AppTransaction } from "../db/client";
import { company, notification, opportunity, settings } from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { DEFAULT_TIME_ZONE } from "../db/timezone";
import { completeTask, listDueItems, type DueItem } from "./tasks";

const TERMINAL_OPPORTUNITY_STAGES = new Set<string>(
  OPPORTUNITY_TERMINAL_STAGES.map((stage) => stage.value),
);

export type Notification = typeof notification.$inferSelect;

export type NotificationListItem = Notification & {
  muted: boolean;
};

export class NotificationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationInputError";
  }
}

type MaterializeSource = {
  kind: DueSourceKind;
  dueKey: string;
  title: string;
  body: string;
  dueOn: string;
  entityType: string | null;
  entityId: string | null;
  derivedFromKey: string | null;
};

export type MaterializeResult = {
  count: number;
  ids: string[];
};

export type NotificationClock = {
  now?: Date;
  timeZone?: string;
};

function workspaceTimeZone(
  database: AppDatabase,
  tenant: TenantContext,
  fallback?: string,
): string {
  return (
    fallback ??
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE
  );
}

function mutedKindSet(value: string[] | null | undefined): Set<string> {
  return new Set((value ?? []).filter((kind) => kind.length > 0));
}

export function listMutedNotificationKinds(
  database: AppDatabase,
  tenant: TenantContext,
): string[] {
  const row = getWorkspaceSettings(database, tenant, tenant.workspaceId);
  return [...mutedKindSet(row?.mutedNotificationKindsJson)];
}

function titleForDueItem(item: DueItem): string {
  const parsed = parseDueSourceKey(item.sourceKey);
  if (!parsed || parsed.kind === "task") {
    return item.title;
  }
  return todayDoNowHeading(
    item.sourceKey,
    todayDoNowVerbForKey(item.sourceKey),
    item.entityLabel,
  );
}

function sourcesFromDueItems(items: DueItem[]): MaterializeSource[] {
  const sources: MaterializeSource[] = [];
  for (const item of items) {
    const parsed = parseDueSourceKey(item.sourceKey);
    if (!parsed || !item.dueOn) {
      continue;
    }
    sources.push({
      kind: parsed.kind,
      dueKey: item.sourceKey,
      title: titleForDueItem(item),
      body: item.title,
      dueOn: item.dueOn,
      entityType: item.entityType,
      entityId: item.entityId,
      derivedFromKey: item.derivedFromKey,
    });
  }
  return sources;
}

function listDeadlineSources(
  database: AppDatabase,
  tenant: TenantContext,
): MaterializeSource[] {
  const sources: MaterializeSource[] = [];
  for (const row of database
    .select({
      id: opportunity.id,
      dueOn: opportunity.deadlineOn,
      stage: opportunity.stage,
      label: company.name,
      role: opportunity.role,
    })
    .from(opportunity)
    .innerJoin(
      company,
      and(
        eq(company.workspaceId, opportunity.workspaceId),
        eq(company.id, opportunity.companyId),
      ),
    )
    .where(eq(opportunity.workspaceId, tenant.workspaceId))
    .all()) {
    if (
      !row.dueOn ||
      TERMINAL_OPPORTUNITY_STAGES.has(row.stage)
    ) {
      continue;
    }
    const entityLabel = `${row.label} ${row.role}`.trim();
    const dueKey = dueSourceKey("opportunity_deadline", row.id);
    sources.push({
      kind: "opportunity_deadline",
      dueKey,
      title: todayDoNowHeading(dueKey, "Apply", entityLabel),
      body: "Application deadline",
      dueOn: row.dueOn,
      entityType: "opportunity",
      entityId: row.id,
      derivedFromKey: null,
    });
  }
  return sources;
}

function upsertSource(
  transaction: AppTransaction,
  tenant: TenantContext,
  source: MaterializeSource,
  timeZone: string,
  now: Date,
): string {
  const entityId =
    source.entityId ?? parseDueSourceKey(source.dueKey)?.entityId ?? "";
  const groupKey = notificationGroupKey({
    kind: source.kind,
    entityId,
    derivedFromKey: source.derivedFromKey,
  });
  const dueAt = startOfZonedDay(source.dueOn, timeZone);
  const id = randomUUID();
  transaction
    .insert(notification)
    .values({
      id,
      workspaceId: tenant.workspaceId,
      kind: source.kind,
      entityType: source.entityType,
      entityId: source.entityId,
      title: source.title,
      body: source.body,
      dueOn: source.dueOn,
      dueAt,
      dueKey: source.dueKey,
      groupKey,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [notification.workspaceId, notification.dueKey],
      set: {
        kind: source.kind,
        entityType: source.entityType,
        entityId: source.entityId,
        title: source.title,
        body: source.body,
        dueOn: source.dueOn,
        dueAt,
        groupKey,
      },
    })
    .run();
  const stored = transaction
    .select({ id: notification.id })
    .from(notification)
    .where(
      and(
        eq(notification.workspaceId, tenant.workspaceId),
        eq(notification.dueKey, source.dueKey),
      ),
    )
    .get();
  if (!stored) {
    throw new Error("Notification upsert did not produce a row.");
  }
  return stored.id;
}

export function materializeNotifications(
  database: AppDatabase,
  tenant: TenantContext,
  clock: NotificationClock = {},
): MaterializeResult {
  const now = clock.now ?? new Date();
  const timeZone = workspaceTimeZone(database, tenant, clock.timeZone);
  const dueSources = sourcesFromDueItems(listDueItems(database, tenant));
  const seen = new Set(dueSources.map((source) => source.dueKey));
  const sources = [
    ...dueSources,
    ...listDeadlineSources(database, tenant).filter(
      (source) => !seen.has(source.dueKey),
    ),
  ];
  return database.transaction((transaction) => {
    const ids = sources.map((source) =>
      upsertSource(transaction, tenant, source, timeZone, now),
    );
    return { count: ids.length, ids };
  });
}

export function listSnoozedDueKeys(
  database: AppDatabase,
  tenant: TenantContext,
  now: Date,
): Set<string> {
  const rows = database
    .select({ dueKey: notification.dueKey })
    .from(notification)
    .where(
      and(
        eq(notification.workspaceId, tenant.workspaceId),
        isNotNull(notification.snoozedUntil),
        gt(notification.snoozedUntil, now),
      ),
    )
    .all();
  return new Set(rows.map((row) => row.dueKey));
}

export function listNotifications(
  database: AppDatabase,
  tenant: TenantContext,
  tab: NotificationTab,
  clock: NotificationClock = {},
): NotificationListItem[] {
  const now = clock.now ?? new Date();
  const timeZone = workspaceTimeZone(database, tenant, clock.timeZone);
  const asOfOn = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const mutedKinds = new Set(listMutedNotificationKinds(database, tenant));
  return database
    .select()
    .from(notification)
    .where(eq(notification.workspaceId, tenant.workspaceId))
    .orderBy(asc(notification.dueOn), asc(notification.title))
    .all()
    .filter((row) =>
      matchesNotificationTab(
        {
          dueOn: row.dueOn,
          kind: row.kind as DueSourceKind,
          readAt: row.readAt,
          dismissedAt: row.dismissedAt,
          completedAt: row.completedAt,
          snoozedUntil: row.snoozedUntil,
        },
        tab,
        { asOfOn, now, mutedKinds },
      ),
    )
    .map((row) => ({ ...row, muted: mutedKinds.has(row.kind) }));
}

export function countUnreadNotifications(
  database: AppDatabase,
  tenant: TenantContext,
  clock: NotificationClock = {},
): number {
  return listNotifications(database, tenant, "unread", clock).length;
}

function ownedNotifications(
  transaction: AppTransaction,
  tenant: TenantContext,
  ids: string[],
): Notification[] {
  if (ids.length === 0) {
    return [];
  }
  const uniqueIds = [...new Set(ids)];
  const rows = transaction
    .select()
    .from(notification)
    .where(
      and(
        eq(notification.workspaceId, tenant.workspaceId),
        inArray(notification.id, uniqueIds),
      ),
    )
    .all();
  if (rows.length !== uniqueIds.length) {
    return [];
  }
  return rows;
}

export function snoozeNotifications(
  database: AppDatabase,
  tenant: TenantContext,
  ids: string[],
  until: Date,
  now: Date = new Date(),
): Notification[] {
  if (until.getTime() <= now.getTime()) {
    throw new NotificationInputError("Snooze until must be in the future.");
  }
  return database.transaction((transaction) => {
    const rows = ownedNotifications(transaction, tenant, ids);
    if (rows.length === 0) {
      return [];
    }
    transaction
      .update(notification)
      .set({ snoozedUntil: until })
      .where(
        and(
          eq(notification.workspaceId, tenant.workspaceId),
          inArray(
            notification.id,
            rows.map((row) => row.id),
          ),
        ),
      )
      .run();
    return ownedNotifications(
      transaction,
      tenant,
      rows.map((row) => row.id),
    );
  });
}

export function snoozeNotificationsByPreset(
  database: AppDatabase,
  tenant: TenantContext,
  ids: string[],
  preset: SnoozePreset,
  clock: NotificationClock = {},
): Notification[] {
  const now = clock.now ?? new Date();
  const timeZone = workspaceTimeZone(database, tenant, clock.timeZone);
  return snoozeNotifications(
    database,
    tenant,
    ids,
    snoozeUntil(preset, now, timeZone),
    now,
  );
}

export function dismissNotifications(
  database: AppDatabase,
  tenant: TenantContext,
  ids: string[],
  now: Date = new Date(),
): Notification[] {
  return database.transaction((transaction) => {
    const rows = ownedNotifications(transaction, tenant, ids);
    if (rows.length === 0) {
      return [];
    }
    transaction
      .update(notification)
      .set({ dismissedAt: now, readAt: now })
      .where(
        and(
          eq(notification.workspaceId, tenant.workspaceId),
          inArray(
            notification.id,
            rows.map((row) => row.id),
          ),
        ),
      )
      .run();
    return ownedNotifications(
      transaction,
      tenant,
      rows.map((row) => row.id),
    );
  });
}

export function completeNotifications(
  database: AppDatabase,
  tenant: TenantContext,
  ids: string[],
  now: Date = new Date(),
): Notification[] {
  const updated = database.transaction((transaction) => {
    const rows = ownedNotifications(transaction, tenant, ids);
    if (rows.length === 0) {
      return [];
    }
    transaction
      .update(notification)
      .set({ completedAt: now, readAt: now })
      .where(
        and(
          eq(notification.workspaceId, tenant.workspaceId),
          inArray(
            notification.id,
            rows.map((row) => row.id),
          ),
        ),
      )
      .run();
    return ownedNotifications(
      transaction,
      tenant,
      rows.map((row) => row.id),
    );
  });
  for (const row of updated) {
    const parsed = parseDueSourceKey(row.dueKey);
    if (parsed?.kind === "task") {
      completeTask(database, tenant, parsed.entityId, now);
    }
  }
  return updated;
}

export function muteNotificationKind(
  database: AppDatabase,
  tenant: TenantContext,
  kind: DueSourceKind,
): string[] {
  return database.transaction((transaction) => {
    const row = transaction
      .select()
      .from(settings)
      .where(eq(settings.workspaceId, tenant.workspaceId))
      .get();
    const next = [...mutedKindSet(row?.mutedNotificationKindsJson).add(kind)];
    transaction
      .update(settings)
      .set({ mutedNotificationKindsJson: next })
      .where(eq(settings.workspaceId, tenant.workspaceId))
      .run();
    return next;
  });
}

export function parseNotificationTab(
  value: string | null | undefined,
): NotificationTab {
  return value && isNotificationTab(value) ? value : "unread";
}

export function resolveSnoozeUntil(
  input: { preset?: string; until?: string },
  now: Date,
  timeZone: string,
): Date {
  if (input.until) {
    const parsed = new Date(input.until);
    if (Number.isNaN(parsed.valueOf())) {
      throw new NotificationInputError("Snooze until must be a real instant.");
    }
    return parsed;
  }
  if (input.preset && isSnoozePreset(input.preset)) {
    return snoozeUntil(input.preset, now, timeZone);
  }
  throw new NotificationInputError("Choose a snooze preset or a custom time.");
}

export { requestForbidsNotificationWrites, isSnoozePreset };
export type { NotificationTab, SnoozePreset };

import {
  parseDueSourceKey,
  type DueSourceKind,
} from "./due-source";
import { shiftCalendarDate } from "./referral";

export const NOTIFICATION_EMPTY =
  "No notifications. Due follow-ups will land here.";

export const NOTIFICATION_ERROR = "Could not load notifications";

export const NOTIFICATION_TABS = [
  { key: "unread", label: "Unread" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "overdue", label: "Overdue" },
  { key: "muted", label: "Muted" },
  { key: "all", label: "All" },
] as const;

export type NotificationTab = (typeof NOTIFICATION_TABS)[number]["key"];

export const SNOOZE_PRESETS = ["1h", "3h", "tomorrow", "monday"] as const;

export type SnoozePreset = (typeof SNOOZE_PRESETS)[number];

export const NOTIFICATION_KIND_LABELS: Record<DueSourceKind, string> = {
  company_next_action: "Company next action",
  contact_next_action: "Networking follow-up",
  opportunity_next_action: "Opportunity next action",
  opportunity_deadline: "Application deadline",
  referral_follow_up: "Referral follow-up",
  interview: "Interview",
  assessment_deadline: "OA deadline",
  offer_deadline: "Offer deadline",
  task: "Task",
};

export function isNotificationTab(value: string): value is NotificationTab {
  return NOTIFICATION_TABS.some((tab) => tab.key === value);
}

export function isSnoozePreset(value: string): value is SnoozePreset {
  return (SNOOZE_PRESETS as readonly string[]).includes(value);
}

export function notificationKindLabel(kind: DueSourceKind): string {
  return NOTIFICATION_KIND_LABELS[kind];
}

/**
 * §32 grouping is presentation: explicit entity + action class.
 * Sharing an entity and a calendar day is never enough.
 */
export function notificationGroupKey(input: {
  kind: DueSourceKind;
  entityId: string;
  derivedFromKey?: string | null;
}): string | null {
  if (
    input.kind === "opportunity_next_action" ||
    input.kind === "opportunity_deadline"
  ) {
    return `opportunity:${input.entityId}:apply`;
  }
  if (input.kind !== "task" || !input.derivedFromKey) {
    return null;
  }
  const parsed = parseDueSourceKey(input.derivedFromKey);
  if (
    parsed?.kind === "opportunity_next_action" ||
    parsed?.kind === "opportunity_deadline"
  ) {
    return `opportunity:${parsed.entityId}:apply`;
  }
  return null;
}

export function isSnoozedAt(
  snoozedUntil: Date | null | undefined,
  now: Date,
): boolean {
  return snoozedUntil != null && snoozedUntil.getTime() > now.getTime();
}

export function matchesNotificationTab(
  row: {
    dueOn: string;
    kind: DueSourceKind;
    readAt: Date | null;
    dismissedAt: Date | null;
    completedAt: Date | null;
    snoozedUntil: Date | null;
  },
  tab: NotificationTab,
  context: {
    asOfOn: string;
    now: Date;
    mutedKinds: ReadonlySet<string>;
  },
): boolean {
  const muted = context.mutedKinds.has(row.kind);
  const snoozed = isSnoozedAt(row.snoozedUntil, context.now);
  const closed = row.dismissedAt != null || row.completedAt != null;
  const unread =
    row.readAt == null && !closed && !snoozed && !muted;

  switch (tab) {
    case "unread":
      return unread;
    case "today":
      return !muted && row.dueOn === context.asOfOn;
    case "upcoming":
      return !muted && row.dueOn > context.asOfOn;
    case "overdue":
      return !muted && row.dueOn < context.asOfOn;
    case "muted":
      return muted;
    case "all":
      return true;
  }
}

export function groupNotificationCards<
  T extends { groupKey: string | null; dueKey: string },
>(rows: T[]): Array<{ groupKey: string | null; members: T[] }> {
  const grouped = new Map<string, T[]>();
  const cards: Array<{ groupKey: string | null; members: T[] }> = [];
  for (const row of rows) {
    if (!row.groupKey) {
      cards.push({ groupKey: null, members: [row] });
      continue;
    }
    const existing = grouped.get(row.groupKey);
    if (existing) {
      existing.push(row);
      continue;
    }
    const members = [row];
    grouped.set(row.groupKey, members);
    cards.push({ groupKey: row.groupKey, members });
  }
  return cards;
}

export function nextMondayOn(asOfOn: string): string {
  const parsed = new Date(`${asOfOn}T00:00:00.000Z`);
  const weekday = parsed.getUTCDay();
  const add = weekday === 1 ? 7 : (8 - weekday) % 7;
  return shiftCalendarDate(asOfOn, add);
}

export function startOfZonedDay(dateOn: string, timeZone: string): Date {
  const match = dateOn.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new RangeError("Calendar dates must use YYYY-MM-DD.");
  }
  return zonedLocalToUtc(
    timeZone,
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    0,
    0,
  );
}

export function snoozeUntil(
  preset: SnoozePreset,
  now: Date,
  timeZone: string,
): Date {
  if (preset === "1h") {
    return new Date(now.getTime() + 60 * 60 * 1000);
  }
  if (preset === "3h") {
    return new Date(now.getTime() + 3 * 60 * 60 * 1000);
  }
  const asOfOn = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const targetOn =
    preset === "tomorrow" ? shiftCalendarDate(asOfOn, 1) : nextMondayOn(asOfOn);
  return startOfZonedDay(targetOn, timeZone);
}

export function isNextPrefetchRequest(headers: {
  get(name: string): string | null;
}): boolean {
  const prefetch = headers.get("next-router-prefetch");
  if (prefetch === "1" || prefetch === "true") {
    return true;
  }
  const purpose = headers.get("purpose") ?? headers.get("sec-purpose");
  return purpose === "prefetch";
}

export function requestForbidsNotificationWrites(
  request: Request,
): boolean {
  return (
    request.method === "GET" ||
    request.method === "HEAD" ||
    isNextPrefetchRequest(request.headers)
  );
}

function zonedParts(timeZone: string, instant: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function zonedLocalToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const asZone = zonedParts(timeZone, new Date(utcGuess));
  const asUtc = Date.UTC(
    asZone.year,
    asZone.month - 1,
    asZone.day,
    asZone.hour,
    asZone.minute,
    asZone.second,
  );
  const adjusted = new Date(utcGuess - (asUtc - utcGuess));
  const check = zonedParts(timeZone, adjusted);
  if (
    check.year === year &&
    check.month === month &&
    check.day === day &&
    check.hour === hour &&
    check.minute === minute
  ) {
    return adjusted;
  }
  return new Date(adjusted.getTime() + 60 * 60 * 1000);
}

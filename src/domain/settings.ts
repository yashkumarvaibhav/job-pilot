/**
 * Quiet hours (§28) are wall-clock minutes in the workspace zone, never instants.
 * Stored timestamps stay UTC; only the reading of "what time is it here" moves.
 */

export const MINUTES_IN_DAY = 1440;

export const SETTINGS_PROFILE_MAX = 120;

export const QUIET_HOURS_OFF_LABEL = "Off";

export const SETTINGS_LOADING = "Loading settings";

export const SETTINGS_ERROR = "Could not load settings";

export const TIMEZONE_HELP =
  "Today, quiet hours, digests and scheduling use this zone. Saving a new zone does not move any timestamp already stored.";

export const QUIET_HOURS_ACTIVE_LABEL = "Quiet right now";

export const QUIET_HOURS_AWAKE_LABEL = "Not quiet right now";

export const QUIET_HOURS_HELP =
  "The notification center still lists everything during quiet hours. A future morning digest is what will wait for them to end.";

export const GMAIL_NOT_CONNECTED_TITLE = "Gmail is not connected yet";

export const GMAIL_NOT_CONNECTED_HELP =
  "Connecting a mailbox arrives with the Gmail phase. Until then nothing here reads or sends mail, and there is no address to disconnect.";

export const SCORING_EMPTY_TITLE = "Scoring weights are not set yet";

export const SCORING_EMPTY_HELP =
  "Opportunity scoring arrives with the scoring phase. When it does, its terms become numeric fields here rather than a hidden file.";

/** Modern IANA names this platform's ICU may still enumerate under a legacy alias. */
const MODERN_ZONE_NAMES = [
  "America/Argentina/Buenos_Aires",
  "Asia/Ho_Chi_Minh",
  "Asia/Kathmandu",
  "Asia/Kolkata",
  "Asia/Yangon",
  "Europe/Kyiv",
  "UTC",
] as const;

export class QuietHoursError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuietHoursError";
  }
}

export function parseClockMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

export function formatClockMinutes(minutes: number): string {
  const wrapped = ((minutes % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Start is quiet, end is already awake, and a start after the end wraps midnight —
 * which is the shape §28's own example (11:30 PM – 8:00 AM) takes.
 */
export function isWithinQuietHours(
  minutes: number,
  quietStart: number | null,
  quietEnd: number | null,
): boolean {
  if (quietStart == null || quietEnd == null || quietStart === quietEnd) {
    return false;
  }
  return quietStart < quietEnd
    ? minutes >= quietStart && minutes < quietEnd
    : minutes >= quietStart || minutes < quietEnd;
}

export function quietHoursLabel(
  quietStart: number | null,
  quietEnd: number | null,
): string {
  if (quietStart == null || quietEnd == null) {
    return QUIET_HOURS_OFF_LABEL;
  }
  return `${formatClockMinutes(quietStart)} – ${formatClockMinutes(quietEnd)}`;
}

export function parseQuietHours(input: {
  start?: string | null;
  end?: string | null;
}): { quietStart: number | null; quietEnd: number | null } {
  const start = (input.start ?? "").trim();
  const end = (input.end ?? "").trim();

  if (start.length === 0 && end.length === 0) {
    return { quietStart: null, quietEnd: null };
  }
  if (start.length === 0 || end.length === 0) {
    throw new QuietHoursError(
      "Set both a quiet-hours start and end, or clear both.",
    );
  }

  const quietStart = parseClockMinutes(start);
  const quietEnd = parseClockMinutes(end);
  if (quietStart == null || quietEnd == null) {
    throw new QuietHoursError("Quiet hours use 24-hour HH:MM times.");
  }
  if (quietStart === quietEnd) {
    throw new QuietHoursError(
      "Quiet hours must not start and end at the same time.",
    );
  }
  return { quietStart, quietEnd };
}

export function minutesOfDayInZone(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? "0",
  );
  return hour * 60 + minute;
}

export function isQuietHourInZone(
  timeZone: string,
  at: Date,
  quietStart: number | null,
  quietEnd: number | null,
): boolean {
  return isWithinQuietHours(
    minutesOfDayInZone(timeZone, at),
    quietStart,
    quietEnd,
  );
}

/** The sentence the settings screen shows under the window, read in the saved zone. */
export function quietHoursStateLine(
  timeZone: string,
  at: Date,
  quietStart: number | null,
  quietEnd: number | null,
): { active: boolean; label: string; sentence: string } {
  const localTime = formatClockMinutes(minutesOfDayInZone(timeZone, at));
  if (quietStart == null || quietEnd == null) {
    return {
      active: false,
      label: QUIET_HOURS_AWAKE_LABEL,
      sentence: `Quiet hours are off. It is ${localTime} in ${timeZone}.`,
    };
  }
  const active = isQuietHourInZone(timeZone, at, quietStart, quietEnd);
  return {
    active,
    label: active ? QUIET_HOURS_ACTIVE_LABEL : QUIET_HOURS_AWAKE_LABEL,
    sentence: `It is ${localTime} in ${timeZone}, ${
      active ? "inside" : "outside"
    } ${quietHoursLabel(quietStart, quietEnd)}.`,
  };
}

export function normalizeProfileText(
  value: string | null | undefined,
): string {
  return (value ?? "").trim();
}

/**
 * The platform list plus the modern names it may omit, plus whatever is already
 * saved — a workspace never loses the ability to re-pick its own zone.
 */
export function selectableTimeZones(current: string): string[] {
  const zones = new Set<string>(MODERN_ZONE_NAMES);
  for (const zone of Intl.supportedValuesOf("timeZone")) {
    zones.add(zone);
  }
  const saved = current.trim();
  if (saved.length > 0) {
    zones.add(saved);
  }
  return [...zones].sort();
}

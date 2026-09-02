import { calendarDateInZone } from "./referral";

export const INTERVIEW_KIND_SUGGESTIONS = [
  "Coding",
  "LLD",
  "HLD",
  "System Design",
  "Hiring Manager",
  "HR",
  "Behavioral",
] as const;

export const INTERVIEW_PENDING_LABEL = "Pending";

export function interviewRoundTitle(roundIndex: number, kind: string): string {
  return `Round ${roundIndex} · ${kind.trim()}`;
}

export function isPendingInterviewResult(
  result: string | null | undefined,
): boolean {
  return result == null || result.trim().length === 0;
}

export function interviewDueOn(
  at: Date | null | undefined,
  timeZone: string,
): string | null {
  if (at == null) {
    return null;
  }
  return calendarDateInZone(timeZone, at);
}

export function isInterviewOnCalendarDate(
  at: Date | null | undefined,
  timeZone: string,
  asOfOn: string,
): boolean {
  const dueOn = interviewDueOn(at, timeZone);
  return dueOn === asOfOn;
}

export function zonedInterviewAt(
  timeZone: string,
  dateOn: string,
  timeHm: string,
): Date {
  const dateMatch = dateOn.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeHm.match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) {
    throw new RangeError("Interview date must be YYYY-MM-DD and time HH:mm.");
  }
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) {
    throw new RangeError("Interview time must be a real clock time.");
  }
  const instant = zonedLocalToUtc(timeZone, year, month, day, hour, minute);
  const check = calendarDateInZone(timeZone, instant);
  if (check !== dateOn) {
    throw new RangeError("Interview date must be a real calendar date.");
  }
  return instant;
}

export function formatInterviewWhen(
  at: Date | null | undefined,
  timeZone: string,
): { dateOn: string | null; time: string | null; label: string } {
  if (at == null) {
    return { dateOn: null, time: null, label: INTERVIEW_PENDING_LABEL };
  }
  const dateOn = calendarDateInZone(timeZone, at);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
  return { dateOn, time, label: `${dateOn} · ${time}` };
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

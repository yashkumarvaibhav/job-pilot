import { zonedInterviewAt } from "./interview";
import { calendarDateInZone, shiftCalendarDate } from "./referral";

export const ASSESSMENT_KIND_SUGGESTIONS = [
  "Online Assessment",
  "Take-home",
  "Coding test",
] as const;

export const ASSESSMENT_PLATFORM_SUGGESTIONS = [
  "HackerRank",
  "Codility",
  "CodeSignal",
  "LeetCode",
  "Karat",
  "HireVue",
] as const;

export const ASSESSMENT_STATUSES = [
  { value: "invited", label: "Invited" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number]["value"];

export const DEFAULT_ASSESSMENT_STATUS: AssessmentStatus = "invited";

const statusValues = new Set<string>(
  ASSESSMENT_STATUSES.map((status) => status.value),
);

/** Upcoming OA/offer deadlines still surface on Today and Deadlines. */
export const DEADLINE_OBJECT_HORIZON_DAYS = 2;

export function isAssessmentStatus(
  value: unknown,
): value is AssessmentStatus {
  return typeof value === "string" && statusValues.has(value);
}

export function assessmentStatusLabel(value: AssessmentStatus): string {
  return ASSESSMENT_STATUSES.find((status) => status.value === value)!.label;
}

export function isOpenAssessmentStatus(
  status: string | null | undefined,
): boolean {
  return status === "invited";
}

export function isCompletedAssessmentStatus(
  status: string | null | undefined,
): boolean {
  return status === "completed";
}

export function assessmentDueOn(
  dueAt: Date | null | undefined,
  timeZone: string,
): string | null {
  if (dueAt == null) {
    return null;
  }
  return calendarDateInZone(timeZone, dueAt);
}

export function zonedAssessmentDueAt(
  timeZone: string,
  dateOn: string,
  timeHm: string,
): Date {
  return zonedInterviewAt(timeZone, dateOn, timeHm);
}

export function isDueInsideHorizon(
  dueOn: string | null | undefined,
  asOfOn: string,
  horizonDays: number = DEADLINE_OBJECT_HORIZON_DAYS,
): boolean {
  return (
    typeof dueOn === "string" &&
    dueOn.length > 0 &&
    dueOn <= shiftCalendarDate(asOfOn, horizonDays)
  );
}

export function isOverdueOn(
  dueOn: string | null | undefined,
  asOfOn: string,
): boolean {
  return typeof dueOn === "string" && dueOn.length > 0 && dueOn < asOfOn;
}

export function derivedAssessmentTitle(companyName: string): string {
  const company = companyName.trim();
  return company.length > 0
    ? `Complete ${company} assessment`
    : "Complete assessment";
}

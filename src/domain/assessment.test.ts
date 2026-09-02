import { describe, expect, it } from "vitest";

import { calendarDateInZone, shiftCalendarDate } from "./referral";
import {
  ASSESSMENT_STATUSES,
  DEADLINE_OBJECT_HORIZON_DAYS,
  assessmentDueOn,
  assessmentStatusLabel,
  derivedAssessmentTitle,
  isCompletedAssessmentStatus,
  isDueInsideHorizon,
  isOpenAssessmentStatus,
  isOverdueOn,
  zonedAssessmentDueAt,
} from "./assessment";

describe("assessment domain", () => {
  it("names invited, completed, and cancelled without a third pipeline", () => {
    expect(ASSESSMENT_STATUSES.map(({ label }) => label)).toEqual([
      "Invited",
      "Completed",
      "Cancelled",
    ]);
    expect(assessmentStatusLabel("invited")).toBe("Invited");
    expect(isOpenAssessmentStatus("invited")).toBe(true);
    expect(isOpenAssessmentStatus("completed")).toBe(false);
    expect(isCompletedAssessmentStatus("completed")).toBe(true);
    expect(isCompletedAssessmentStatus("invited")).toBe(false);
  });

  it("treats tomorrow as inside the horizon and a completed status as closed", () => {
    expect(DEADLINE_OBJECT_HORIZON_DAYS).toBe(2);
    expect(isDueInsideHorizon("2026-09-03", "2026-09-02")).toBe(true);
    expect(isDueInsideHorizon("2026-09-04", "2026-09-02")).toBe(true);
    expect(isDueInsideHorizon("2026-09-05", "2026-09-02")).toBe(false);
    expect(isDueInsideHorizon("2026-09-01", "2026-09-02")).toBe(true);
    expect(isDueInsideHorizon(null, "2026-09-02")).toBe(false);
    expect(isOverdueOn("2026-09-01", "2026-09-02")).toBe(true);
    expect(isOverdueOn("2026-09-02", "2026-09-02")).toBe(false);
    expect(isOverdueOn("2026-09-03", "2026-09-02")).toBe(false);
    expect(shiftCalendarDate("2026-09-02", DEADLINE_OBJECT_HORIZON_DAYS)).toBe(
      "2026-09-04",
    );
  });

  it("converts a workspace-local due clock using the saved zone, not the host", () => {
    const now = new Date("2026-09-02T02:00:00.000Z");
    expect(calendarDateInZone("Asia/Kolkata", now)).toBe("2026-09-02");
    expect(calendarDateInZone("America/New_York", now)).toBe("2026-09-01");

    const dueAt = zonedAssessmentDueAt("Asia/Kolkata", "2026-09-03", "18:00");
    expect(dueAt.toISOString()).toBe("2026-09-03T12:30:00.000Z");
    expect(assessmentDueOn(dueAt, "Asia/Kolkata")).toBe("2026-09-03");
    expect(assessmentDueOn(null, "Asia/Kolkata")).toBeNull();
    expect(derivedAssessmentTitle("Google")).toBe(
      "Complete Google assessment",
    );
    expect(derivedAssessmentTitle("  ")).toBe("Complete assessment");
  });
});

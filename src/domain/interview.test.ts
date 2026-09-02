import { describe, expect, it } from "vitest";

import { calendarDateInZone } from "./referral";
import {
  formatInterviewWhen,
  INTERVIEW_PENDING_LABEL,
  interviewDueOn,
  interviewRoundTitle,
  isInterviewOnCalendarDate,
  isPendingInterviewResult,
  zonedInterviewAt,
} from "./interview";

describe("interview domain", () => {
  const now = new Date("2026-09-02T02:00:00.000Z");

  it("does not treat a pending round with no timestamp as today", () => {
    expect(isInterviewOnCalendarDate(null, "Asia/Kolkata", "2026-09-02")).toBe(
      false,
    );
    expect(interviewDueOn(null, "Asia/Kolkata")).toBeNull();
    expect(isPendingInterviewResult(null)).toBe(true);
    expect(isPendingInterviewResult("")).toBe(true);
    expect(isPendingInterviewResult("  ")).toBe(true);
    expect(isPendingInterviewResult("Passed")).toBe(false);
  });

  it("counts one frozen UTC instant as today in Kolkata and not in New York", () => {
    expect(calendarDateInZone("Asia/Kolkata", now)).toBe("2026-09-02");
    expect(calendarDateInZone("America/New_York", now)).toBe("2026-09-01");

    const at = new Date("2026-09-02T06:00:00.000Z");
    expect(isInterviewOnCalendarDate(at, "Asia/Kolkata", "2026-09-02")).toBe(
      true,
    );
    expect(
      isInterviewOnCalendarDate(at, "America/New_York", "2026-09-01"),
    ).toBe(false);
    expect(interviewDueOn(at, "Asia/Kolkata")).toBe("2026-09-02");
    expect(interviewDueOn(at, "America/New_York")).toBe("2026-09-02");
  });

  it("interprets workspace-local date and time as a UTC instant", () => {
    const at = zonedInterviewAt("Asia/Kolkata", "2026-09-02", "11:00");
    expect(at.toISOString()).toBe("2026-09-02T05:30:00.000Z");
    expect(formatInterviewWhen(at, "Asia/Kolkata")).toEqual({
      dateOn: "2026-09-02",
      time: "11:00",
      label: "2026-09-02 · 11:00",
    });
    expect(formatInterviewWhen(null, "Asia/Kolkata").label).toBe(
      INTERVIEW_PENDING_LABEL,
    );
  });

  it("names rounds in stored order", () => {
    expect(interviewRoundTitle(1, " Coding ")).toBe("Round 1 · Coding");
    expect(interviewRoundTitle(2, "LLD")).toBe("Round 2 · LLD");
  });
});

import { describe, expect, it } from "vitest";

import {
  formatClockMinutes,
  isWithinQuietHours,
  isQuietHourInZone,
  minutesOfDayInZone,
  normalizeProfileText,
  parseClockMinutes,
  parseQuietHours,
  QUIET_HOURS_ACTIVE_LABEL,
  QUIET_HOURS_AWAKE_LABEL,
  QuietHoursError,
  quietHoursStateLine,
  quietHoursLabel,
  QUIET_HOURS_OFF_LABEL,
  selectableTimeZones,
} from "./settings";

describe("settings domain", () => {
  it("parses and formats a wall clock time, rejecting anything else", () => {
    expect(parseClockMinutes("23:30")).toBe(1410);
    expect(parseClockMinutes("00:00")).toBe(0);
    expect(parseClockMinutes("08:00")).toBe(480);
    expect(formatClockMinutes(1410)).toBe("23:30");
    expect(formatClockMinutes(0)).toBe("00:00");
    expect(formatClockMinutes(480)).toBe("08:00");

    for (const junk of ["", "8:00", "24:00", "23:60", "11:30 PM", "0800"]) {
      expect(parseClockMinutes(junk)).toBeNull();
    }
  });

  it("treats a window that wraps past midnight as one quiet stretch", () => {
    const start = 1410; // 23:30
    const end = 480; // 08:00

    expect(isWithinQuietHours(1410, start, end)).toBe(true);
    expect(isWithinQuietHours(1439, start, end)).toBe(true);
    expect(isWithinQuietHours(0, start, end)).toBe(true);
    expect(isWithinQuietHours(479, start, end)).toBe(true);
    // The end minute is already awake.
    expect(isWithinQuietHours(480, start, end)).toBe(false);
    expect(isWithinQuietHours(1409, start, end)).toBe(false);
    expect(isWithinQuietHours(720, start, end)).toBe(false);
  });

  it("treats a same-day window as a plain range", () => {
    expect(isWithinQuietHours(780, 720, 840)).toBe(true);
    expect(isWithinQuietHours(720, 720, 840)).toBe(true);
    expect(isWithinQuietHours(840, 720, 840)).toBe(false);
    expect(isWithinQuietHours(60, 720, 840)).toBe(false);
  });

  it("is never quiet when quiet hours are off", () => {
    expect(isWithinQuietHours(0, null, null)).toBe(false);
    expect(isWithinQuietHours(720, null, null)).toBe(false);
    expect(isWithinQuietHours(720, 720, null)).toBe(false);
    expect(isWithinQuietHours(720, null, 840)).toBe(false);
    expect(quietHoursLabel(null, null)).toBe(QUIET_HOURS_OFF_LABEL);
    expect(quietHoursLabel(1410, 480)).toBe("23:30 – 08:00");
  });

  it("accepts both fields or neither, and rejects a half-set or empty window", () => {
    expect(parseQuietHours({ start: "23:30", end: "08:00" })).toEqual({
      quietStart: 1410,
      quietEnd: 480,
    });
    expect(parseQuietHours({ start: "", end: "" })).toEqual({
      quietStart: null,
      quietEnd: null,
    });
    expect(parseQuietHours({})).toEqual({ quietStart: null, quietEnd: null });

    expect(() => parseQuietHours({ start: "23:30", end: "" })).toThrow(
      QuietHoursError,
    );
    expect(() => parseQuietHours({ start: "", end: "08:00" })).toThrow(
      QuietHoursError,
    );
    expect(() => parseQuietHours({ start: "08:00", end: "08:00" })).toThrow(
      QuietHoursError,
    );
    expect(() => parseQuietHours({ start: "nope", end: "08:00" })).toThrow(
      QuietHoursError,
    );
  });

  it("reads the minute of the day in the workspace zone, not the server zone", () => {
    const at = new Date("2026-09-02T18:45:00.000Z");

    expect(minutesOfDayInZone("Asia/Kolkata", at)).toBe(15); // 00:15 next day
    expect(minutesOfDayInZone("America/New_York", at)).toBe(14 * 60 + 45);
    expect(minutesOfDayInZone("UTC", at)).toBe(18 * 60 + 45);
  });

  it("makes one instant quiet in one workspace zone and awake in another", () => {
    const start = 1410; // 23:30
    const end = 480; // 08:00

    // 00:15 in Kolkata, 14:45 the previous afternoon in New York.
    const night = new Date("2026-09-02T18:45:00.000Z");
    expect(isQuietHourInZone("Asia/Kolkata", night, start, end)).toBe(true);
    expect(isQuietHourInZone("America/New_York", night, start, end)).toBe(false);

    // 11:30 in Kolkata, 02:00 in New York.
    const morning = new Date("2026-09-02T06:00:00.000Z");
    expect(isQuietHourInZone("Asia/Kolkata", morning, start, end)).toBe(false);
    expect(isQuietHourInZone("America/New_York", morning, start, end)).toBe(true);
  });

  it("says whether right now is inside the window, read in the saved zone", () => {
    const night = new Date("2026-09-02T18:45:00.000Z");

    const kolkata = quietHoursStateLine("Asia/Kolkata", night, 1410, 480);
    expect(kolkata.active).toBe(true);
    expect(kolkata.label).toBe(QUIET_HOURS_ACTIVE_LABEL);
    expect(kolkata.sentence).toBe(
      "It is 00:15 in Asia/Kolkata, inside 23:30 – 08:00.",
    );

    const newYork = quietHoursStateLine("America/New_York", night, 1410, 480);
    expect(newYork.active).toBe(false);
    expect(newYork.label).toBe(QUIET_HOURS_AWAKE_LABEL);
    expect(newYork.sentence).toBe(
      "It is 14:45 in America/New_York, outside 23:30 – 08:00.",
    );

    const off = quietHoursStateLine("Asia/Kolkata", night, null, null);
    expect(off.active).toBe(false);
    expect(off.sentence).toBe("Quiet hours are off. It is 00:15 in Asia/Kolkata.");
  });

  it("trims profile text and keeps an empty field empty rather than blank-ish", () => {
    expect(normalizeProfileText("  Yash Kumar Vaibhav  ")).toBe(
      "Yash Kumar Vaibhav",
    );
    expect(normalizeProfileText("   ")).toBe("");
    expect(normalizeProfileText(null)).toBe("");
    expect(normalizeProfileText(undefined)).toBe("");
  });

  it("offers a sorted zone list that always contains the saved zone and the default", () => {
    const zones = selectableTimeZones("Asia/Kolkata");

    expect(zones).toContain("Asia/Kolkata");
    expect(zones).toContain("America/New_York");
    expect(zones).toContain("UTC");
    expect([...zones].sort()).toEqual(zones);
    expect(new Set(zones).size).toBe(zones.length);

    // A saved zone the platform does not enumerate is still selectable.
    const withLegacy = selectableTimeZones("Asia/Calcutta");
    expect(withLegacy).toContain("Asia/Calcutta");
    expect(withLegacy).toContain("Asia/Kolkata");
  });
});

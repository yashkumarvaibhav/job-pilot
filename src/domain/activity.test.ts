import { describe, expect, it } from "vitest";

import {
  activityCalendarDate,
  activityDayHeading,
  formatActivityHeadline,
  formatActivityTime,
  isValidActivityDay,
} from "./activity";

describe("activity copy", () => {
  it("uses the global-feed verbs from section 44", () => {
    expect(
      formatActivityHeadline({
        kind: "APPLICATION_SUBMITTED",
        entityLabel: "Razorpay SDE",
      }),
    ).toBe("Application submitted → Razorpay SDE");
    expect(
      formatActivityHeadline({
        kind: "ASSESSMENT_INVITED",
        entityLabel: "Google SDE",
      }),
    ).toBe("Assessment invited → Google SDE");
    expect(
      formatActivityHeadline({
        kind: "ASSESSMENT_COMPLETED",
        entityLabel: "Google SDE",
      }),
    ).toBe("Assessment completed → Google SDE");
    expect(
      formatActivityHeadline({
        kind: "OFFER_DEADLINE_SET",
        entityLabel: "Google SDE",
      }),
    ).toBe("Offer deadline set → Google SDE");
    expect(
      formatActivityHeadline({
        kind: "INTERACTION_REPLIED",
        entityLabel: "Rahul Sharma",
        payload: { channel: "email" },
      }),
    ).toBe("Email reply received ← Rahul Sharma");
    expect(
      formatActivityHeadline({
        kind: "INTERACTION_SENT",
        entityLabel: "Rahul Sharma",
        payload: { channel: "whatsapp" },
      }),
    ).toBe("WhatsApp sent → Rahul Sharma");
    expect(
      formatActivityHeadline({
        kind: "TAG_ATTACHED",
        entityLabel: "Microsoft",
        payload: { label: "Dream Company" },
      }),
    ).toBe("Tagged Dream Company → Microsoft");
  });

  it("formats clock time and calendar days in the workspace zone", () => {
    const at = new Date("2026-09-01T09:34:00.000Z");
    expect(formatActivityTime(at, "Asia/Kolkata")).toBe("15:04");
    expect(activityCalendarDate(at, "Asia/Kolkata")).toBe("2026-09-01");
    expect(activityDayHeading("2026-09-01", "2026-09-01")).toBe("Today");
    expect(activityDayHeading("2026-08-31", "2026-09-01")).toBe("2026-08-31");
    expect(isValidActivityDay("2026-09-01")).toBe(true);
    expect(isValidActivityDay("2026-13-01")).toBe(false);
  });
});

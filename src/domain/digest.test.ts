import { describe, expect, it } from "vitest";

import {
  canUseSelfDigestPolicy,
  digestLocalDate,
  digestTickAction,
  DIGEST_SUBJECT,
  formatDigestBody,
  parseDigestHour,
} from "./digest";

const POLICY = {
  enabled: true,
  accountId: "account-a",
  approvedEmail: "owner-a@invalid.test",
  digestHour: 8,
  timeZone: "Asia/Kolkata",
  quietStart: null as number | null,
  quietEnd: null as number | null,
};

describe("morning digest domain", () => {
  it("renders a deterministic list, including zeroes, never a paragraph", () => {
    expect(formatDigestBody({
      followUps: 5,
      deadlines: 3,
      oa: 1,
      replies: 2,
      interviewsToday: 1,
    })).toBe(
      [
        "TODAY",
        "",
        "5 follow-ups due",
        "3 deadlines",
        "1 OA",
        "2 recruiter replies awaiting action",
        "1 interview today",
      ].join("\n"),
    );
    expect(formatDigestBody({
      followUps: 0,
      deadlines: 0,
      oa: 0,
      replies: 0,
      interviewsToday: 0,
    })).toContain("0 follow-ups due");
    expect(DIGEST_SUBJECT).toBe("Your Job Search Summary");
  });

  it("accepts only a whole hour from 0 to 23", () => {
    expect(parseDigestHour("")).toBeNull();
    expect(parseDigestHour(null)).toBeNull();
    expect(parseDigestHour(8)).toBe(8);
    expect(parseDigestHour("08")).toBe(8);
    expect(parseDigestHour(0)).toBe(0);
    expect(parseDigestHour(23)).toBe(23);
    expect(() => parseDigestHour(24)).toThrow(RangeError);
    expect(() => parseDigestHour(8.5)).toThrow(RangeError);
    expect(() => parseDigestHour("morning")).toThrow(RangeError);
  });

  it("allows self-digest policy only when origin, sender and recipient are the same address", () => {
    expect(
      canUseSelfDigestPolicy({
        origin: "self_digest",
        recipient: "owner-a@invalid.test",
        accountEmail: "owner-a@invalid.test",
      }),
    ).toBe(true);
    expect(
      canUseSelfDigestPolicy({
        origin: "self_digest",
        recipient: "other@invalid.test",
        accountEmail: "owner-a@invalid.test",
      }),
    ).toBe(false);
    expect(
      canUseSelfDigestPolicy({
        origin: "one_off",
        recipient: "owner-a@invalid.test",
        accountEmail: "owner-a@invalid.test",
      }),
    ).toBe(false);
  });

  it("holds the tick until the saved-zone hour, then preview-only unless opt-in is live", () => {
    const beforeHour = new Date("2026-09-04T02:29:00.000Z"); // 07:59 in Kolkata
    const atHour = new Date("2026-09-04T02:30:00.000Z"); // 08:00 in Kolkata

    expect(
      digestTickAction({
        now: beforeHour,
        policy: POLICY,
        accountStatus: "connected",
        currentAccountEmail: "owner-a@invalid.test",
        queuedLocalDate: null,
      }),
    ).toBe("skip_hour");
    expect(
      digestTickAction({
        now: atHour,
        policy: { ...POLICY, enabled: false },
        accountStatus: "connected",
        currentAccountEmail: "owner-a@invalid.test",
        queuedLocalDate: null,
      }),
    ).toBe("preview");
    expect(
      digestTickAction({
        now: atHour,
        policy: POLICY,
        accountStatus: "connected",
        currentAccountEmail: "owner-a@invalid.test",
        queuedLocalDate: null,
      }),
    ).toBe("enqueue");
  });

  it("does not enqueue twice on the same local date and isolates IANA zones", () => {
    const kolkataMorning = new Date("2026-09-04T02:30:00.000Z");
    const newYorkMorning = new Date("2026-09-04T12:00:00.000Z");

    expect(digestLocalDate("Asia/Kolkata", kolkataMorning)).toBe("2026-09-04");
    expect(digestLocalDate("America/New_York", kolkataMorning)).toBe("2026-09-03");
    expect(
      digestTickAction({
        now: kolkataMorning,
        policy: POLICY,
        accountStatus: "connected",
        currentAccountEmail: "owner-a@invalid.test",
        queuedLocalDate: "2026-09-04",
      }),
    ).toBe("skip_already_queued");
    expect(
      digestTickAction({
        now: newYorkMorning,
        policy: {
          ...POLICY,
          timeZone: "America/New_York",
          approvedEmail: "owner-b@invalid.test",
          accountId: "account-b",
        },
        accountStatus: "connected",
        currentAccountEmail: "owner-b@invalid.test",
        queuedLocalDate: null,
      }),
    ).toBe("enqueue");
  });

  it("skips send when quiet, disconnected, or the live address no longer matches", () => {
    const atHour = new Date("2026-09-04T02:30:00.000Z");
    expect(
      digestTickAction({
        now: atHour,
        policy: { ...POLICY, quietStart: 0, quietEnd: 600 },
        accountStatus: "connected",
        currentAccountEmail: "owner-a@invalid.test",
        queuedLocalDate: null,
      }),
    ).toBe("skip_quiet");
    expect(
      digestTickAction({
        now: atHour,
        policy: POLICY,
        accountStatus: "disconnected",
        currentAccountEmail: "owner-a@invalid.test",
        queuedLocalDate: null,
      }),
    ).toBe("skip_disconnected");
    expect(
      digestTickAction({
        now: atHour,
        policy: POLICY,
        accountStatus: "connected",
        currentAccountEmail: "renamed@invalid.test",
        queuedLocalDate: null,
      }),
    ).toBe("skip_disconnected");
  });
});

import { describe, expect, it } from "vitest";

import { opportunityHealth } from "./opportunity-health";

describe("opportunity health", () => {
  it("renders the section 59 received-referral deadline example", () => {
    expect(
      opportunityHealth(
        {
          deadlineOn: "2026-09-05",
          hasApplication: false,
          referralAvailable: true,
        },
        "2026-09-03",
      ),
    ).toEqual({
      tone: "warning",
      title: "Action required",
      sentence: "Apply before 2026-09-05.",
      reasons: [
        "Deadline is in 2 days.",
        "Referral received.",
        "Application not submitted.",
      ],
    });
  });

  it("makes a missed deadline a danger state", () => {
    expect(
      opportunityHealth(
        {
          deadlineOn: "2026-09-02",
          hasApplication: false,
          referralAvailable: false,
        },
        "2026-09-03",
      ),
    ).toEqual({
      tone: "danger",
      title: "Deadline passed",
      sentence: "The application deadline was 2026-09-02.",
      reasons: ["Application not submitted."],
    });
  });

  it("names a deadline soon even without a referral", () => {
    expect(
      opportunityHealth(
        {
          deadlineOn: "2026-09-06",
          hasApplication: false,
          referralAvailable: false,
        },
        "2026-09-03",
      ),
    ).toMatchObject({
      tone: "warning",
      title: "Deadline soon",
      sentence: "Apply before 2026-09-06.",
    });
  });

  it("names a received referral that has not become an application", () => {
    expect(
      opportunityHealth(
        {
          deadlineOn: null,
          hasApplication: false,
          referralAvailable: true,
        },
        "2026-09-03",
      ),
    ).toEqual({
      tone: "warning",
      title: "Referral ready",
      sentence:
        "A referral is received, but the application is not submitted.",
      reasons: ["Referral received.", "Application not submitted."],
    });
  });

  it("does not raise an application risk after submission or without a signal", () => {
    expect(
      opportunityHealth(
        {
          deadlineOn: "2026-09-02",
          hasApplication: true,
          referralAvailable: true,
        },
        "2026-09-03",
      ),
    ).toBeNull();
    expect(
      opportunityHealth(
        {
          deadlineOn: null,
          hasApplication: false,
          referralAvailable: false,
        },
        "2026-09-03",
      ),
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  ANALYTICS_EMPTY,
  ANALYTICS_HONESTY,
  ANALYTICS_MIN_N,
  COMPANY_CONVERSION_TILES,
  FUNNEL_STEPS,
  SLICE_COLUMNS,
  applicationSlice,
  buildAnalyticsSnapshot,
  buildCompanyConversion,
  isFunnelOaStage,
  isFunnelOfferStage,
  isReferralAttemptStage,
  isReferralObtainedStage,
  rateForDenominator,
  type AnalyticsFacts,
} from "./analytics";

function facts(overrides: Partial<AnalyticsFacts> = {}): AnalyticsFacts {
  return {
    opportunities: [],
    applications: [],
    referrals: [],
    interactions: [],
    interviews: [],
    ...overrides,
  };
}

describe("analytics honesty and grouping", () => {
  it("keeps the documented empty sentence and n < 5 cutoff", () => {
    expect(ANALYTICS_EMPTY).toBe(
      "Not enough outcomes to chart. Counts appear once applications exist.",
    );
    expect(ANALYTICS_HONESTY).toBe("n < 5 — not enough data");
    expect(ANALYTICS_MIN_N).toBe(5);
    expect(FUNNEL_STEPS.map((step) => step.label)).toEqual([
      "Opportunities pursued",
      "Referral attempts",
      "Referrals obtained",
      "Applications",
      "OA",
      "Interviews",
      "Offers",
    ]);
    expect(SLICE_COLUMNS.map((column) => column.label)).toEqual([
      "Referral applications",
      "Cold applications",
    ]);
    expect(COMPANY_CONVERSION_TILES.map((tile) => tile.label)).toEqual([
      "Active opportunities",
      "Applications",
      "Contacts",
      "Referral requests",
      "Referrals received",
      "Interviews",
    ]);
  });

  it("suppresses the percentage when n is below 5 and still returns the count", () => {
    expect(rateForDenominator(2, 4)).toEqual({
      percent: null,
      label: ANALYTICS_HONESTY,
      suppressed: true,
      denominator: 4,
    });
    expect(rateForDenominator(0, 0)).toEqual({
      percent: null,
      label: ANALYTICS_HONESTY,
      suppressed: true,
      denominator: 0,
    });
    expect(rateForDenominator(12, 38)).toEqual({
      percent: 31.6,
      label: "31.6%",
      suppressed: false,
      denominator: 38,
    });
    expect(rateForDenominator(3, 5)).toEqual({
      percent: 60,
      label: "60.0%",
      suppressed: false,
      denominator: 5,
    });
  });

  it("groups an application as referral only when that opportunity has a received referral", () => {
    const received = new Set(["opp-referred"]);
    expect(applicationSlice("opp-referred", received)).toBe("referral");
    expect(applicationSlice("opp-cold", received)).toBe("cold");
    expect(applicationSlice("opp-referred", new Set())).toBe("cold");
  });

  it("treats requested-or-later stages as attempts and received as obtained", () => {
    expect(isReferralAttemptStage("potential_contact")).toBe(false);
    expect(isReferralAttemptStage("ready_to_contact")).toBe(false);
    expect(isReferralAttemptStage("requested")).toBe(true);
    expect(isReferralAttemptStage("declined")).toBe(true);
    expect(isReferralObtainedStage("referral_submitted")).toBe(false);
    expect(isReferralObtainedStage("referral_received")).toBe(true);
    expect(isFunnelOaStage("oa_received")).toBe(true);
    expect(isFunnelOaStage("oa_completed")).toBe(true);
    expect(isFunnelOaStage("interview_scheduled")).toBe(false);
    expect(isFunnelOfferStage("offer")).toBe(true);
    expect(isFunnelOfferStage("applied")).toBe(false);
  });

  it("shows the empty sentence instead of 0% bars when no applications exist", () => {
    const snapshot = buildAnalyticsSnapshot(
      facts({
        opportunities: [{ id: "opp-1", bucket: "active" }],
        referrals: [
          {
            id: "ref-1",
            opportunityId: "opp-1",
            stage: "requested",
            channel: "whatsapp",
          },
        ],
      }),
    );

    expect(snapshot.empty).toBe(true);
    expect(snapshot.emptyCopy).toBe(ANALYTICS_EMPTY);
    expect(snapshot.funnel.every((step) => step.rate.percent === null)).toBe(
      true,
    );
  });

  it("builds the funnel with counts always visible and rates hidden below n = 5", () => {
    const snapshot = buildAnalyticsSnapshot(
      facts({
        opportunities: [
          { id: "o1", bucket: "active" },
          { id: "o2", bucket: "saved" },
          { id: "o3", bucket: "active" },
        ],
        referrals: [
          {
            id: "r1",
            opportunityId: "o1",
            stage: "requested",
            channel: "email",
          },
          {
            id: "r2",
            opportunityId: "o1",
            stage: "referral_received",
            channel: "whatsapp",
          },
          {
            id: "r3",
            opportunityId: "o2",
            stage: "potential_contact",
            channel: "linkedin_dm",
          },
        ],
        applications: [
          { id: "a1", opportunityId: "o1", stage: "oa_received" },
          { id: "a2", opportunityId: "o2", stage: "applied" },
          { id: "a3", opportunityId: "o3", stage: "offer" },
        ],
        interviews: [{ opportunityId: "o3" }],
      }),
    );

    expect(snapshot.empty).toBe(false);
    expect(
      Object.fromEntries(
        snapshot.funnel.map((step) => [step.key, step.count]),
      ),
    ).toEqual({
      opportunitiesPursued: 3,
      referralAttempts: 2,
      referralsObtained: 1,
      applications: 3,
      oa: 1,
      interviews: 1,
      offers: 1,
    });
    expect(
      snapshot.funnel.find((step) => step.key === "referralsObtained")?.rate,
    ).toMatchObject({ suppressed: true, label: ANALYTICS_HONESTY });
    expect(
      snapshot.funnel.find((step) => step.key === "oa")?.rate,
    ).toMatchObject({ suppressed: true, label: ANALYTICS_HONESTY });
  });

  it("shows percentages once a funnel denominator reaches five", () => {
    const snapshot = buildAnalyticsSnapshot(
      facts({
        opportunities: Array.from({ length: 8 }, (_, index) => ({
          id: `o${index + 1}`,
          bucket: "active" as const,
        })),
        referrals: Array.from({ length: 8 }, (_, index) => ({
          id: `r${index + 1}`,
          opportunityId: `o${index + 1}`,
          stage:
            index < 4
              ? ("referral_received" as const)
              : ("requested" as const),
          channel: "email" as const,
        })),
        applications: Array.from({ length: 8 }, (_, index) => ({
          id: `a${index + 1}`,
          opportunityId: `o${index + 1}`,
          stage:
            index === 0
              ? ("offer" as const)
              : index < 3
                ? ("oa_completed" as const)
                : ("applied" as const),
        })),
        interviews: [{ opportunityId: "o1" }, { opportunityId: "o2" }],
      }),
    );

    const obtained = snapshot.funnel.find(
      (step) => step.key === "referralsObtained",
    );
    const oa = snapshot.funnel.find((step) => step.key === "oa");
    const interviews = snapshot.funnel.find((step) => step.key === "interviews");
    const offers = snapshot.funnel.find((step) => step.key === "offers");

    expect(obtained).toMatchObject({
      count: 4,
      rate: { percent: 50, label: "50.0%", suppressed: false, denominator: 8 },
    });
    expect(oa).toMatchObject({
      count: 2,
      rate: { percent: 25, label: "25.0%", suppressed: false, denominator: 8 },
    });
    expect(interviews).toMatchObject({
      count: 2,
      rate: { percent: 25, label: "25.0%", suppressed: false, denominator: 8 },
    });
    expect(offers).toMatchObject({
      count: 1,
      rate: {
        percent: 12.5,
        label: "12.5%",
        suppressed: false,
        denominator: 8,
      },
    });
  });

  it("splits applications into referral vs cold using received referrals only", () => {
    const snapshot = buildAnalyticsSnapshot(
      facts({
        applications: [
          { id: "a1", opportunityId: "referred-role", stage: "applied" },
          { id: "a2", opportunityId: "cold-role", stage: "applied" },
          { id: "a3", opportunityId: "other-referred", stage: "applied" },
          { id: "a4", opportunityId: "promised-only", stage: "applied" },
          { id: "a5", opportunityId: "cold-two", stage: "applied" },
        ],
        referrals: [
          {
            id: "r1",
            opportunityId: "referred-role",
            stage: "referral_received",
            channel: "whatsapp",
          },
          {
            id: "r2",
            opportunityId: "other-referred",
            stage: "referral_received",
            channel: "email",
          },
          {
            id: "r3",
            opportunityId: "promised-only",
            stage: "referral_promised",
            channel: "linkedin_dm",
          },
        ],
        interviews: [
          { opportunityId: "referred-role" },
          { opportunityId: "referred-role" },
          { opportunityId: "cold-role" },
        ],
      }),
    );

    expect(snapshot.slices).toEqual([
      {
        key: "referral",
        label: "Referral applications",
        applications: 2,
        interviews: 1,
        rate: {
          percent: null,
          label: ANALYTICS_HONESTY,
          suppressed: true,
          denominator: 2,
        },
      },
      {
        key: "cold",
        label: "Cold applications",
        applications: 3,
        interviews: 1,
        rate: {
          percent: null,
          label: ANALYTICS_HONESTY,
          suppressed: true,
          denominator: 3,
        },
      },
    ]);
  });

  it("counts channel attempts, replies, and obtained referrals without inventing extra dimensions", () => {
    const snapshot = buildAnalyticsSnapshot(
      facts({
        applications: [{ id: "a1", opportunityId: "o1", stage: "applied" }],
        interactions: [
          { channel: "whatsapp", direction: "outbound" },
          { channel: "whatsapp", direction: "outbound" },
          { channel: "whatsapp", direction: "inbound" },
          { channel: "email", direction: "outbound" },
          { channel: "linkedin_dm", direction: "inbound" },
        ],
        referrals: [
          {
            id: "r1",
            opportunityId: "o1",
            stage: "referral_received",
            channel: "whatsapp",
          },
          {
            id: "r2",
            opportunityId: "o2",
            stage: "requested",
            channel: "email",
          },
        ],
      }),
    );

    expect(snapshot.channels).toEqual([
      {
        channel: "whatsapp",
        label: "WhatsApp",
        attempts: 2,
        replies: 1,
        referrals: 1,
      },
      {
        channel: "email",
        label: "Email",
        attempts: 1,
        replies: 0,
        referrals: 0,
      },
      {
        channel: "linkedin_dm",
        label: "LinkedIn DM",
        attempts: 0,
        replies: 1,
        referrals: 0,
      },
    ]);
  });

  it("counts company conversion rows, not rates", () => {
    expect(
      buildCompanyConversion({
        opportunities: [
          { bucket: "active" },
          { bucket: "active" },
          { bucket: "saved" },
        ],
        applications: [{}, {}],
        contacts: [{}, {}, {}],
        referrals: [
          { stage: "requested" },
          { stage: "referral_received" },
          { stage: "potential_contact" },
        ],
        interviews: [{}, {}],
      }),
    ).toEqual({
      activeOpportunities: 2,
      applications: 2,
      contacts: 3,
      referralRequests: 3,
      referralsReceived: 1,
      interviews: 2,
    });
  });
});

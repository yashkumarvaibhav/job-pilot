import { describe, expect, it } from "vitest";

import { shiftCalendarDate } from "./referral";
import {
  AUTOMATION_RULES,
  REFERRAL_NO_RESPONSE_TASK_TITLE,
  RULE_THRESHOLDS,
  assertStaleMarkHasReason,
  automationRuleRowId,
  canAdvanceToReadyToApply,
  evaluateStaleMarks,
  formatStaleReason,
  indexStaleMarks,
  referralNoResponseDueOn,
  referralNoResponseTaskKey,
  type StaleScanInput,
} from "./rules";

const AS_OF = "2026-09-03";

function enabledAll(): Set<string> {
  return new Set(AUTOMATION_RULES.map((rule) => rule.slug));
}

function scan(overrides: Partial<StaleScanInput> = {}): StaleScanInput {
  return {
    asOfOn: AS_OF,
    enabled: enabledAll(),
    opportunities: [],
    referrals: [],
    contacts: [],
    interactions: [],
    assessments: [],
    interviews: [],
    activity: [],
    ...overrides,
  };
}

describe("built-in automation catalog", () => {
  it("names every §23 CRM write slug and every §51 stale slug", () => {
    expect(AUTOMATION_RULES.map((rule) => rule.slug)).toEqual([
      "referral_no_response_follow_up",
      "referral_received_ready_to_apply",
      "applied_cancel_referral_outreach",
      "stale_opportunity_no_activity",
      "stale_no_recruiter_response",
      "stale_referral_promised_not_received",
      "stale_referral_received_not_applied",
      "stale_job_deadline",
      "stale_assessment_deadline",
      "stale_interview_past_no_result",
      "stale_networking_check_later",
    ]);
    expect(AUTOMATION_RULES.filter((rule) => rule.kind === "stale")).toHaveLength(
      8,
    );
    expect(
      AUTOMATION_RULES.find((rule) => rule.slug === "stale_opportunity_no_activity")
        ?.label,
    ).toBe("No activity");
  });

  it("keeps the §23 / §51 thresholds as named constants", () => {
    expect(RULE_THRESHOLDS.referralNoResponseDays).toBe(4);
    expect(RULE_THRESHOLDS.opportunityNoActivityDays).toBe(7);
    expect(RULE_THRESHOLDS.noRecruiterResponseDays).toBe(14);
    expect(RULE_THRESHOLDS.referralPromisedNotReceivedDays).toBe(5);
    expect(RULE_THRESHOLDS.jobDeadlineDays).toBe(3);
    expect(RULE_THRESHOLDS.assessmentDeadlineDays).toBe(2);
    expect(REFERRAL_NO_RESPONSE_TASK_TITLE).toBe("Follow up on referral");
    expect(referralNoResponseDueOn("2026-08-28")).toBe("2026-09-01");
    expect(referralNoResponseTaskKey("ref-1")).toBe(
      "rule:referral_no_response_follow_up:ref-1",
    );
    expect(automationRuleRowId("workspace-a", "stale_job_deadline")).toBe(
      "workspace-a:stale_job_deadline",
    );
  });

  it("does not advance an already applied or closed opportunity", () => {
    expect(canAdvanceToReadyToApply("pursuing")).toBe(true);
    expect(canAdvanceToReadyToApply("referral_received")).toBe(true);
    expect(canAdvanceToReadyToApply("ready_to_apply")).toBe(false);
    expect(canAdvanceToReadyToApply("applied")).toBe(false);
    expect(canAdvanceToReadyToApply("withdrawn")).toBe(false);
  });
});

describe("stale reasons", () => {
  it("always names the condition; an empty reason is a failure", () => {
    for (const rule of AUTOMATION_RULES.filter((item) => item.kind === "stale")) {
      const reason = formatStaleReason(rule.slug, {
        days: 6,
        dateOn: "2026-08-28",
      });
      expect(reason.length).toBeGreaterThan(0);
      expect(
        assertStaleMarkHasReason({
          slug: rule.slug,
          entityType: "opportunity",
          entityId: "job-1",
          reason,
        }).reason,
      ).toBe(reason);
    }
    expect(() =>
      assertStaleMarkHasReason({
        slug: "stale_opportunity_no_activity",
        entityType: "opportunity",
        entityId: "job-1",
        reason: "   ",
      }),
    ).toThrow(/must name the condition/);
  });
});

describe("§51 stale evaluation", () => {
  it("marks an active opportunity with no activity for 7 days", () => {
    const marks = evaluateStaleMarks(
      scan({
        opportunities: [
          {
            id: "silent",
            bucket: "active",
            stage: "pursuing",
            createdOn: shiftCalendarDate(AS_OF, -8),
            deadlineOn: null,
            hasApplication: false,
          },
          {
            id: "saved",
            bucket: "saved",
            stage: "discovered",
            createdOn: shiftCalendarDate(AS_OF, -8),
            deadlineOn: null,
            hasApplication: false,
          },
        ],
      }),
    );
    expect(marks).toEqual([
      expect.objectContaining({
        slug: "stale_opportunity_no_activity",
        entityId: "silent",
        reason: "No activity for 8 days",
      }),
    ]);
  });

  it("does not mark no-activity when the slug is disabled", () => {
    const enabled = enabledAll();
    enabled.delete("stale_opportunity_no_activity");
    const marks = evaluateStaleMarks(
      scan({
        enabled,
        opportunities: [
          {
            id: "silent",
            bucket: "active",
            stage: "pursuing",
            createdOn: shiftCalendarDate(AS_OF, -8),
            deadlineOn: shiftCalendarDate(AS_OF, 2),
            hasApplication: false,
          },
        ],
      }),
    );
    expect(
      marks.find((mark) => mark.slug === "stale_opportunity_no_activity"),
    ).toBeUndefined();
    expect(marks.some((mark) => mark.slug === "stale_job_deadline")).toBe(true);
  });

  it("marks no recruiter response 14 days after the last outbound", () => {
    const outboundOn = shiftCalendarDate(AS_OF, -14);
    const marks = evaluateStaleMarks(
      scan({
        opportunities: [
          {
            id: "job-1",
            bucket: "active",
            stage: "pursuing",
            createdOn: outboundOn,
            deadlineOn: null,
            hasApplication: false,
          },
        ],
        interactions: [
          {
            opportunityId: "job-1",
            direction: "outbound",
            occurredOn: outboundOn,
            occurredAtMs: Date.parse(`${outboundOn}T10:00:00.000Z`),
          },
        ],
      }),
    );
    expect(marks).toContainEqual(
      expect.objectContaining({
        slug: "stale_no_recruiter_response",
        reason: "No recruiter response 14 days after the last outbound",
      }),
    );
  });

  it("clears no-recruiter-response after a later inbound", () => {
    const outboundOn = shiftCalendarDate(AS_OF, -14);
    const marks = evaluateStaleMarks(
      scan({
        opportunities: [
          {
            id: "job-1",
            bucket: "active",
            stage: "pursuing",
            createdOn: outboundOn,
            deadlineOn: null,
            hasApplication: false,
          },
        ],
        interactions: [
          {
            opportunityId: "job-1",
            direction: "outbound",
            occurredOn: outboundOn,
            occurredAtMs: Date.parse(`${outboundOn}T10:00:00.000Z`),
          },
          {
            opportunityId: "job-1",
            direction: "inbound",
            occurredOn: shiftCalendarDate(AS_OF, -1),
            occurredAtMs: Date.parse(`${shiftCalendarDate(AS_OF, -1)}T10:00:00.000Z`),
          },
        ],
      }),
    );
    expect(
      marks.find((mark) => mark.slug === "stale_no_recruiter_response"),
    ).toBeUndefined();
  });

  it("marks referral promised 6 days ago and not received", () => {
    const promisedOn = shiftCalendarDate(AS_OF, -6);
    const marks = evaluateStaleMarks(
      scan({
        opportunities: [
          {
            id: "job-1",
            bucket: "active",
            stage: "referral_promised",
            createdOn: promisedOn,
            deadlineOn: null,
            hasApplication: false,
          },
        ],
        referrals: [
          {
            id: "ref-1",
            opportunityId: "job-1",
            stage: "referral_promised",
            createdOn: promisedOn,
            requestedOn: promisedOn,
          },
        ],
      }),
    );
    expect(marks).toContainEqual(
      expect.objectContaining({
        slug: "stale_referral_promised_not_received",
        entityType: "referral",
        entityId: "ref-1",
        reason: "Referral promised 6 days ago, not received",
      }),
    );
    expect(marks).toContainEqual(
      expect.objectContaining({
        slug: "stale_referral_promised_not_received",
        entityType: "opportunity",
        entityId: "job-1",
      }),
    );
  });

  it("marks referral received with no application submitted", () => {
    const marks = evaluateStaleMarks(
      scan({
        opportunities: [
          {
            id: "job-1",
            bucket: "active",
            stage: "referral_received",
            createdOn: AS_OF,
            deadlineOn: null,
            hasApplication: false,
          },
        ],
        referrals: [
          {
            id: "ref-1",
            opportunityId: "job-1",
            stage: "referral_received",
            createdOn: AS_OF,
            requestedOn: AS_OF,
          },
        ],
      }),
    );
    expect(marks).toContainEqual(
      expect.objectContaining({
        slug: "stale_referral_received_not_applied",
        reason: "Referral received and no application submitted",
      }),
    );
  });

  it("marks a job deadline inside 3 days", () => {
    const deadlineOn = shiftCalendarDate(AS_OF, 3);
    const marks = evaluateStaleMarks(
      scan({
        opportunities: [
          {
            id: "job-1",
            bucket: "active",
            stage: "ready_to_apply",
            createdOn: AS_OF,
            deadlineOn,
            hasApplication: false,
          },
        ],
      }),
    );
    expect(marks).toContainEqual(
      expect.objectContaining({
        slug: "stale_job_deadline",
        reason: `Job deadline ${deadlineOn}`,
      }),
    );
  });

  it("marks an assessment deadline inside 2 days", () => {
    const dueOn = shiftCalendarDate(AS_OF, 2);
    const marks = evaluateStaleMarks(
      scan({
        opportunities: [
          {
            id: "job-1",
            bucket: "active",
            stage: "applied",
            createdOn: AS_OF,
            deadlineOn: null,
            hasApplication: true,
          },
        ],
        assessments: [
          {
            id: "oa-1",
            opportunityId: "job-1",
            status: "invited",
            dueOn,
          },
        ],
      }),
    );
    expect(marks).toContainEqual(
      expect.objectContaining({
        slug: "stale_assessment_deadline",
        entityId: "job-1",
        reason: `Assessment deadline ${dueOn}`,
      }),
    );
  });

  it("marks an interview past with no result recorded", () => {
    const marks = evaluateStaleMarks(
      scan({
        opportunities: [
          {
            id: "job-1",
            bucket: "active",
            stage: "applied",
            createdOn: AS_OF,
            deadlineOn: null,
            hasApplication: true,
          },
        ],
        interviews: [
          {
            id: "int-1",
            opportunityId: "job-1",
            interviewOn: shiftCalendarDate(AS_OF, -1),
            result: null,
          },
        ],
      }),
    );
    expect(marks).toContainEqual(
      expect.objectContaining({
        slug: "stale_interview_past_no_result",
        reason: "Interview past with no result recorded",
      }),
    );
  });

  it("marks a check-later contact whose date has passed", () => {
    const followUpOn = shiftCalendarDate(AS_OF, -1);
    const marks = evaluateStaleMarks(
      scan({
        contacts: [
          {
            id: "rahul",
            networkingStatus: "follow_up_later",
            followUpOn,
          },
        ],
      }),
    );
    expect(marks).toEqual([
      expect.objectContaining({
        slug: "stale_networking_check_later",
        entityType: "contact",
        entityId: "rahul",
        reason: `Check later date ${followUpOn} has passed`,
      }),
    ]);
  });

  it("indexes marks by entity without dropping extra reasons", () => {
    const indexed = indexStaleMarks(
      evaluateStaleMarks(
        scan({
          opportunities: [
            {
              id: "job-1",
              bucket: "active",
              stage: "pursuing",
              createdOn: shiftCalendarDate(AS_OF, -8),
              deadlineOn: shiftCalendarDate(AS_OF, 1),
              hasApplication: false,
            },
          ],
        }),
      ),
    );
    const reasons = indexed.opportunity.get("job-1")?.map((mark) => mark.slug);
    expect(reasons).toEqual(
      expect.arrayContaining([
        "stale_opportunity_no_activity",
        "stale_job_deadline",
      ]),
    );
  });
});

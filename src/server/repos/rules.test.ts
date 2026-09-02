import { afterEach, describe, expect, it } from "vitest";

import { calendarDateInZone, shiftCalendarDate } from "../../domain/referral";
import {
  AUTOMATION_RULES,
  REFERRAL_NO_RESPONSE_TASK_TITLE,
  RULE_THRESHOLDS,
} from "../../domain/rules";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { applyToOpportunity } from "./applications";
import { createAssessment } from "./assessments";
import { createCompany } from "./companies";
import { createContact } from "./contacts";
import { createInteraction } from "./interactions";
import { createInterview } from "./interviews";
import { createOpportunity, getOpportunity } from "./opportunities";
import { createReferral, updateReferral } from "./referrals";
import {
  listAutomationExecutions,
  listAutomationRules,
  listStaleMarks,
  setAutomationRuleEnabled,
} from "./rules";
import { listDueItems, listTasks } from "./tasks";
import { getTodaySnapshot } from "./today";

describe("automation rules", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  function seedJob(
    fixture: ReturnType<typeof createTenantTestFixture>,
    tenant: "tenantA" | "tenantB",
    ids: {
      companyId: string;
      contactId: string;
      opportunityId: string;
    },
    now: Date,
  ) {
    const owner = fixture[tenant];
    createCompany(fixture.client.db, owner, {
      id: ids.companyId,
      name: tenant === "tenantA" ? "Microsoft" : "Private Co",
      now,
    });
    createContact(fixture.client.db, owner, {
      id: ids.contactId,
      companyId: ids.companyId,
      name: tenant === "tenantA" ? "Rahul Sharma" : "Hidden Person",
      now,
    });
    createOpportunity(fixture.client.db, owner, {
      id: ids.opportunityId,
      companyId: ids.companyId,
      role: tenant === "tenantA" ? "SDE" : "Private Role",
      bucket: "active",
      now,
    });
  }

  it("seeds every built-in slug enabled for a new workspace", () => {
    const fixture = newFixture();
    expect(listAutomationRules(fixture.client.db, fixture.tenantA)).toEqual(
      AUTOMATION_RULES.map((rule) => ({
        slug: rule.slug,
        label: rule.label,
        kind: rule.kind,
        enabled: true,
      })),
    );
    expect(
      listAutomationRules(fixture.client.db, fixture.tenantB).map(
        (rule) => rule.slug,
      ),
    ).toEqual(AUTOMATION_RULES.map((rule) => rule.slug));
  });

  it("schedules a no-response follow-up task from a Requested referral", () => {
    const fixture = newFixture();
    const requestedOn = "2026-08-28";
    const now = new Date("2026-09-03T10:00:00.000Z");
    seedJob(fixture, "tenantA", {
      companyId: "microsoft",
      contactId: "rahul",
      opportunityId: "ms-sde",
    }, now);

    createReferral(fixture.client.db, fixture.tenantA, {
      id: "ref-requested",
      contactId: "rahul",
      opportunityId: "ms-sde",
      channel: "whatsapp",
      stage: "requested",
      requestedOn,
      now,
    });

    const tasks = listTasks(fixture.client.db, fixture.tenantA);
    expect(tasks).toEqual([
      expect.objectContaining({
        title: REFERRAL_NO_RESPONSE_TASK_TITLE,
        source: "rule",
        createdByRule: true,
        entityType: "referral",
        entityId: "ref-requested",
        dueOn: shiftCalendarDate(
          requestedOn,
          RULE_THRESHOLDS.referralNoResponseDays,
        ),
        status: "open",
      }),
    ]);
    expect(
      listDueItems(fixture.client.db, fixture.tenantA).some(
        (item) =>
          item.title === REFERRAL_NO_RESPONSE_TASK_TITLE &&
          item.dueOn === "2026-09-01",
      ),
    ).toBe(true);
    const executions = listAutomationExecutions(
      fixture.client.db,
      fixture.tenantA,
    );
    expect(executions).toHaveLength(1);
    expect(executions[0]?.resultJson).toEqual(
      expect.objectContaining({ dueOn: "2026-09-01" }),
    );
    expect(
      listAutomationExecutions(fixture.client.db, fixture.tenantB),
    ).toEqual([]);
  });

  it("does not create a second follow-up task for the same referral", () => {
    const fixture = newFixture();
    const now = new Date("2026-09-03T10:00:00.000Z");
    seedJob(fixture, "tenantA", {
      companyId: "microsoft",
      contactId: "rahul",
      opportunityId: "ms-sde",
    }, now);
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "ref-requested",
      contactId: "rahul",
      opportunityId: "ms-sde",
      channel: "whatsapp",
      stage: "requested",
      requestedOn: "2026-08-28",
      now,
    });
    updateReferral(fixture.client.db, fixture.tenantA, "ref-requested", {
      notes: "Still waiting",
      now: new Date("2026-09-03T11:00:00.000Z"),
    });
    expect(listTasks(fixture.client.db, fixture.tenantA)).toHaveLength(1);
    expect(
      listAutomationExecutions(fixture.client.db, fixture.tenantA),
    ).toHaveLength(1);
  });

  it("advances the opportunity to Ready to Apply when the referral is received", () => {
    const fixture = newFixture();
    const now = new Date("2026-09-03T10:00:00.000Z");
    seedJob(fixture, "tenantA", {
      companyId: "microsoft",
      contactId: "rahul",
      opportunityId: "ms-sde",
    }, now);
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "ref-1",
      contactId: "rahul",
      opportunityId: "ms-sde",
      channel: "email",
      stage: "requested",
      requestedOn: "2026-09-01",
      now,
    });

    updateReferral(fixture.client.db, fixture.tenantA, "ref-1", {
      stage: "referral_received",
      now,
    });

    expect(
      getOpportunity(fixture.client.db, fixture.tenantA, "ms-sde")?.stage,
    ).toBe("ready_to_apply");
    expect(
      getOpportunity(fixture.client.db, fixture.tenantB, "ms-sde"),
    ).toBeUndefined();
  });

  it("cancels pending referral-outreach tasks when the opportunity is applied", () => {
    const fixture = newFixture();
    const now = new Date("2026-09-03T10:00:00.000Z");
    seedJob(fixture, "tenantA", {
      companyId: "microsoft",
      contactId: "rahul",
      opportunityId: "ms-sde",
    }, now);
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "ref-1",
      contactId: "rahul",
      opportunityId: "ms-sde",
      channel: "email",
      stage: "requested",
      requestedOn: "2026-08-28",
      now,
    });
    expect(listTasks(fixture.client.db, fixture.tenantA)[0]?.status).toBe(
      "open",
    );

    applyToOpportunity(fixture.client.db, fixture.tenantA, {
      opportunityId: "ms-sde",
      portal: "Greenhouse",
      appliedOn: "2026-09-03",
      now,
    });

    expect(listTasks(fixture.client.db, fixture.tenantA, { status: "open" })).toEqual(
      [],
    );
    expect(
      listTasks(fixture.client.db, fixture.tenantA, { status: "completed" }),
    ).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        source: "rule",
        status: "completed",
      }),
    ]);
  });

  it("does not treat an inbound reply as sequence cancel (D-014)", () => {
    const fixture = newFixture();
    const now = new Date("2026-09-03T10:00:00.000Z");
    seedJob(fixture, "tenantA", {
      companyId: "microsoft",
      contactId: "rahul",
      opportunityId: "ms-sde",
    }, now);
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "ref-1",
      contactId: "rahul",
      opportunityId: "ms-sde",
      channel: "email",
      stage: "requested",
      requestedOn: "2026-08-28",
      now,
    });
    createInteraction(fixture.client.db, fixture.tenantA, {
      contactId: "rahul",
      opportunityId: "ms-sde",
      channel: "email",
      direction: "inbound",
      occurredAt: now,
      now,
    });
    expect(listTasks(fixture.client.db, fixture.tenantA)[0]?.status).toBe(
      "open",
    );
  });

  it("stops new executions when a slug is disabled and does not rewrite history", () => {
    const fixture = newFixture();
    const now = new Date("2026-09-03T10:00:00.000Z");
    seedJob(fixture, "tenantA", {
      companyId: "microsoft",
      contactId: "rahul",
      opportunityId: "ms-sde",
    }, now);
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "ref-1",
      contactId: "rahul",
      opportunityId: "ms-sde",
      channel: "email",
      stage: "requested",
      requestedOn: "2026-08-28",
      now,
    });
    const before = listTasks(fixture.client.db, fixture.tenantA);
    expect(before).toHaveLength(1);

    setAutomationRuleEnabled(
      fixture.client.db,
      fixture.tenantA,
      "referral_no_response_follow_up",
      false,
      now,
    );
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      companyId: "microsoft",
      name: "Priya Nair",
      now,
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "ref-2",
      contactId: "priya",
      opportunityId: "ms-sde",
      channel: "email",
      stage: "requested",
      requestedOn: "2026-08-28",
      now,
    });

    expect(listTasks(fixture.client.db, fixture.tenantA)).toHaveLength(1);
    expect(listTasks(fixture.client.db, fixture.tenantA)[0]?.id).toBe(
      before[0]?.id,
    );
    expect(
      listAutomationRules(fixture.client.db, fixture.tenantB).find(
        (rule) => rule.slug === "referral_no_response_follow_up",
      )?.enabled,
    ).toBe(true);
  });

  it("derives stale marks without writing, including after Today and a settings list", () => {
    const fixture = newFixture();
    const createdAt = new Date("2026-08-26T04:30:00.000Z");
    seedJob(fixture, "tenantA", {
      companyId: "microsoft",
      contactId: "rahul",
      opportunityId: "ms-sde",
    }, createdAt);
    const executions = listAutomationExecutions(
      fixture.client.db,
      fixture.tenantA,
    ).length;
    const events = fixture.rowCount("activity_event");

    const asOfOn = "2026-09-03";
    const marks = listStaleMarks(fixture.client.db, fixture.tenantA, asOfOn);
    expect(marks.some((mark) => mark.reason.length === 0)).toBe(false);
    expect(marks).toContainEqual(
      expect.objectContaining({
        slug: "stale_opportunity_no_activity",
        entityId: "ms-sde",
        reason: "No activity for 8 days",
      }),
    );

    getTodaySnapshot(fixture.client.db, fixture.tenantA, {
      now: new Date("2026-09-03T10:00:00.000Z"),
    });
    listAutomationRules(fixture.client.db, fixture.tenantA);
    listStaleMarks(fixture.client.db, fixture.tenantA, asOfOn);

    expect(
      listAutomationExecutions(fixture.client.db, fixture.tenantA),
    ).toHaveLength(executions);
    expect(fixture.rowCount("activity_event")).toBe(events);
  });

  it("keeps tenant B's matching ids from mutating tenant A", () => {
    const fixture = newFixture();
    const now = new Date("2026-09-03T10:00:00.000Z");
    seedJob(fixture, "tenantA", {
      companyId: "ms-a",
      contactId: "rahul-a",
      opportunityId: "job-a",
    }, now);
    seedJob(fixture, "tenantB", {
      companyId: "ms-b",
      contactId: "rahul-b",
      opportunityId: "job-b",
    }, now);
    createReferral(fixture.client.db, fixture.tenantB, {
      id: "ref-b",
      contactId: "rahul-b",
      opportunityId: "job-b",
      channel: "email",
      stage: "referral_received",
      now,
    });

    expect(
      getOpportunity(fixture.client.db, fixture.tenantA, "job-b"),
    ).toBeUndefined();
    expect(
      getOpportunity(fixture.client.db, fixture.tenantA, "job-a")?.stage,
    ).not.toBe("ready_to_apply");
    expect(
      getOpportunity(fixture.client.db, fixture.tenantB, "job-b")?.stage,
    ).toBe("ready_to_apply");
    expect(listTasks(fixture.client.db, fixture.tenantA)).toEqual([]);
    expect(
      listStaleMarks(fixture.client.db, fixture.tenantB, "2026-09-03").some(
        (mark) =>
          mark.slug === "stale_referral_received_not_applied" &&
          mark.entityId === "job-b",
      ),
    ).toBe(true);
    expect(
      listStaleMarks(fixture.client.db, fixture.tenantA, "2026-09-03").some(
        (mark) => mark.slug === "stale_referral_received_not_applied",
      ),
    ).toBe(false);
  });

  it("evaluates calendar thresholds in each workspace zone", () => {
    const fixture = newFixture();
    const createdAt = new Date("2026-08-26T20:00:00.000Z");
    seedJob(fixture, "tenantA", {
      companyId: "ms-a",
      contactId: "rahul-a",
      opportunityId: "job-a",
    }, createdAt);
    seedJob(fixture, "tenantB", {
      companyId: "ms-b",
      contactId: "rahul-b",
      opportunityId: "job-b",
    }, createdAt);

    expect(calendarDateInZone("Asia/Kolkata", createdAt)).toBe("2026-08-27");
    expect(calendarDateInZone("America/New_York", createdAt)).toBe("2026-08-26");

    const asOfOn = "2026-09-02";
    const marksA = listStaleMarks(fixture.client.db, fixture.tenantA, asOfOn);
    const marksB = listStaleMarks(fixture.client.db, fixture.tenantB, asOfOn);
    expect(
      marksA.some((mark) => mark.slug === "stale_opportunity_no_activity"),
    ).toBe(false);
    expect(
      marksB.some((mark) => mark.slug === "stale_opportunity_no_activity"),
    ).toBe(true);
  });

  it("covers the remaining §51 stale slugs against live rows", () => {
    const fixture = newFixture();
    const now = new Date("2026-09-03T10:00:00.000Z");
    seedJob(fixture, "tenantA", {
      companyId: "microsoft",
      contactId: "rahul",
      opportunityId: "ms-sde",
    }, now);
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "deadline-job",
      companyId: "microsoft",
      role: "SDE II",
      bucket: "active",
      deadlineOn: "2026-09-05",
      now,
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "promised",
      contactId: "rahul",
      opportunityId: "ms-sde",
      channel: "email",
      stage: "referral_promised",
      requestedOn: "2026-08-28",
      now: new Date("2026-08-28T10:00:00.000Z"),
    });
    createInteraction(fixture.client.db, fixture.tenantA, {
      contactId: "rahul",
      opportunityId: "ms-sde",
      channel: "email",
      direction: "outbound",
      occurredAt: new Date("2026-08-20T10:00:00.000Z"),
      now,
    });
    applyToOpportunity(fixture.client.db, fixture.tenantA, {
      opportunityId: "deadline-job",
      portal: "Lever",
      appliedOn: "2026-09-03",
      now,
    });
    createAssessment(fixture.client.db, fixture.tenantA, {
      opportunityId: "deadline-job",
      kind: "Online Assessment",
      dateOn: "2026-09-04",
      time: "18:00",
      now,
    });
    createInterview(fixture.client.db, fixture.tenantA, {
      opportunityId: "deadline-job",
      kind: "Coding",
      dateOn: "2026-09-01",
      time: "11:00",
      now,
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "later",
      name: "Asha",
      networkingStatus: "follow_up_later",
      followUpOn: "2026-09-01",
      now,
    });

    const slugs = new Set(
      listStaleMarks(fixture.client.db, fixture.tenantA, "2026-09-03").map(
        (mark) => mark.slug,
      ),
    );
    expect([...slugs]).toEqual(
      expect.arrayContaining([
        "stale_no_recruiter_response",
        "stale_referral_promised_not_received",
        "stale_job_deadline",
        "stale_assessment_deadline",
        "stale_interview_past_no_result",
        "stale_networking_check_later",
      ]),
    );
  });

  it("drops the no-activity chip when that slug is disabled and keeps other reasons", () => {
    const fixture = newFixture();
    const createdAt = new Date("2026-08-26T04:30:00.000Z");
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
      now: createdAt,
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "silent",
      companyId: "microsoft",
      role: "SDE",
      bucket: "active",
      deadlineOn: "2026-09-04",
      now: createdAt,
    });

    const before = listStaleMarks(
      fixture.client.db,
      fixture.tenantA,
      "2026-09-03",
    );
    expect(before.map((mark) => mark.slug)).toEqual(
      expect.arrayContaining([
        "stale_opportunity_no_activity",
        "stale_job_deadline",
      ]),
    );

    setAutomationRuleEnabled(
      fixture.client.db,
      fixture.tenantA,
      "stale_opportunity_no_activity",
      false,
    );
    const after = listStaleMarks(
      fixture.client.db,
      fixture.tenantA,
      "2026-09-03",
    );
    expect(
      after.find((mark) => mark.slug === "stale_opportunity_no_activity"),
    ).toBeUndefined();
    expect(after.find((mark) => mark.slug === "stale_job_deadline")).toEqual(
      expect.objectContaining({ entityId: "silent" }),
    );
  });
});

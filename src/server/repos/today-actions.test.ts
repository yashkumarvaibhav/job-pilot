import { afterEach, describe, expect, it } from "vitest";

import { dueSourceKey } from "../../domain/due-source";
import { calendarDateInZone } from "../../domain/referral";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createAssessment, getAssessment } from "./assessments";
import { createCompany, getCompany } from "./companies";
import { createContact, getContact } from "./contacts";
import { createOpportunity, getOpportunity } from "./opportunities";
import { createReferral, getReferral } from "./referrals";
import { completeDerivedDueItem } from "./tasks";

describe("direct Today actions", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  const now = new Date("2026-09-07T08:00:00.000Z");
  const dueOn = calendarDateInZone("Asia/Kolkata", now);

  it("resolves each directly completable source without creating task rows", () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "acme",
      name: "Acme",
      nextAction: "Review careers page",
      nextActionDue: dueOn,
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      name: "Priya Nair",
      nextAction: "Ask about referrals",
      followUpOn: dueOn,
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "acme-sde",
      companyId: "acme",
      role: "SDE",
      nextAction: "Review job description",
      nextActionDue: dueOn,
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "ref-priya",
      contactId: "priya",
      opportunityId: "acme-sde",
      channel: "linkedin_dm",
      stage: "referral_promised",
      nextAction: "Check referral",
      followUpOn: dueOn,
    });
    createAssessment(fixture.client.db, fixture.tenantA, {
      id: "oa-acme",
      opportunityId: "acme-sde",
      kind: "Online Assessment",
      dateOn: dueOn,
      time: "18:00",
      now,
    });

    const sources = [
      dueSourceKey("company_next_action", "acme"),
      dueSourceKey("contact_next_action", "priya"),
      dueSourceKey("opportunity_next_action", "acme-sde"),
      dueSourceKey("referral_follow_up", "ref-priya"),
      dueSourceKey("assessment_deadline", "oa-acme"),
    ];
    for (const sourceKey of sources) {
      expect(
        completeDerivedDueItem(fixture.client.db, fixture.tenantA, {
          sourceKey,
          now,
        }),
      ).toEqual({ outcome: "completed" });
    }

    expect(getCompany(fixture.client.db, fixture.tenantA, "acme")).toMatchObject({
      nextAction: null,
      nextActionDue: null,
    });
    expect(getContact(fixture.client.db, fixture.tenantA, "priya")).toMatchObject({
      nextAction: null,
      followUpOn: null,
    });
    expect(
      getOpportunity(fixture.client.db, fixture.tenantA, "acme-sde"),
    ).toMatchObject({ nextAction: null, nextActionDue: null });
    expect(
      getReferral(fixture.client.db, fixture.tenantA, "ref-priya"),
    ).toMatchObject({ nextAction: null, followUpOn: null });
    expect(getAssessment(fixture.client.db, fixture.tenantA, "oa-acme")).toMatchObject({
      status: "completed",
    });
    expect(
      fixture.client.sqlite
        .prepare("select count(*) as count from task where workspace_id = ?")
        .get(fixture.tenantA.workspaceId),
    ).toEqual({ count: 0 });
  });

  it("is idempotent for a completed company action", () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "acme",
      name: "Acme",
      nextAction: "Review careers page",
      nextActionDue: dueOn,
    });
    const sourceKey = dueSourceKey("company_next_action", "acme");
    expect(
      completeDerivedDueItem(fixture.client.db, fixture.tenantA, { sourceKey, now }),
    ).toEqual({ outcome: "completed" });
    const before = fixture.rowCount("activity_event");
    expect(
      completeDerivedDueItem(fixture.client.db, fixture.tenantA, { sourceKey, now }),
    ).toEqual({ outcome: "already_completed" });
    expect(fixture.rowCount("activity_event")).toBe(before);
  });

  it("does not resolve another workspace's company, opportunity, referral, or assessment", () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantB, {
      id: "private-co",
      name: "Private Co",
      nextAction: "Private action",
      nextActionDue: dueOn,
    });
    createContact(fixture.client.db, fixture.tenantB, {
      id: "private-contact",
      name: "Private Contact",
      followUpOn: dueOn,
    });
    createOpportunity(fixture.client.db, fixture.tenantB, {
      id: "private-role",
      companyId: "private-co",
      role: "Private Role",
      nextAction: "Private opportunity action",
      nextActionDue: dueOn,
    });
    createReferral(fixture.client.db, fixture.tenantB, {
      id: "private-referral",
      contactId: "private-contact",
      opportunityId: "private-role",
      channel: "email",
      followUpOn: dueOn,
    });
    createAssessment(fixture.client.db, fixture.tenantB, {
      id: "private-assessment",
      opportunityId: "private-role",
      kind: "Private assessment",
      dateOn: dueOn,
      time: "18:00",
      now,
    });
    const before = fixture.rowCount("activity_event");
    for (const sourceKey of [
      dueSourceKey("company_next_action", "private-co"),
      dueSourceKey("opportunity_next_action", "private-role"),
      dueSourceKey("referral_follow_up", "private-referral"),
      dueSourceKey("assessment_deadline", "private-assessment"),
    ]) {
      expect(
        completeDerivedDueItem(fixture.client.db, fixture.tenantA, {
          sourceKey,
          now,
        }),
      ).toBeUndefined();
    }
    expect(fixture.rowCount("activity_event")).toBe(before);
  });
});

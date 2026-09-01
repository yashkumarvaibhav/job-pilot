import { afterEach, describe, expect, it } from "vitest";

import { dueSourceKey } from "../../domain/due-source";
import { calendarDateInZone } from "../../domain/referral";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { applyToOpportunity, updateApplication } from "./applications";
import { createCompany } from "./companies";
import { createContact, updateContact } from "./contacts";
import { createInteraction } from "./interactions";
import { createOpportunity } from "./opportunities";
import { createReferral } from "./referrals";
import { createTask } from "./tasks";
import { getTodaySnapshot, listTodayDueItems } from "./today";

describe("Today snapshot", () => {
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

  const now = new Date("2026-09-02T02:00:00.000Z");

  it("filters JP-0014 due items by the workspace calendar date", () => {
    const fixture = newFixture();
    const asOfOn = calendarDateInZone("Asia/Kolkata", now);
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
    });
    updateContact(fixture.client.db, fixture.tenantA, "rahul", {
      nextAction: "Follow up about Microsoft openings",
      followUpOn: asOfOn,
    });
    createTask(fixture.client.db, fixture.tenantA, {
      id: "task-later",
      title: "Prepare system design",
      dueOn: "2026-09-07",
    });
    createTask(fixture.client.db, fixture.tenantA, {
      id: "task-resume",
      title: "Send resume",
      dueOn: asOfOn,
      entityType: "contact",
      entityId: "rahul",
    });

    const items = listTodayDueItems(
      fixture.client.db,
      fixture.tenantA,
      asOfOn,
    );
    expect(items.map((item) => item.sourceKey).sort()).toEqual([
      dueSourceKey("contact_next_action", "rahul"),
      dueSourceKey("task", "task-resume"),
    ]);
  });

  it("scopes counts, due rows, and activity to one workspace timezone", () => {
    const fixture = newFixture();
    const asOfA = calendarDateInZone("Asia/Kolkata", now);
    const asOfB = calendarDateInZone("America/New_York", now);
    expect(asOfA).toBe("2026-09-02");
    expect(asOfB).toBe("2026-09-01");

    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      companyId: "microsoft",
    });
    updateContact(fixture.client.db, fixture.tenantA, "rahul", {
      nextAction: "Follow up about Microsoft openings",
      followUpOn: asOfA,
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "microsoft-sde",
      companyId: "microsoft",
      role: "SDE",
      deadlineOn: asOfA,
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "referral-rahul",
      contactId: "rahul",
      opportunityId: "microsoft-sde",
      channel: "email",
    });
    createInteraction(fixture.client.db, fixture.tenantA, {
      contactId: "rahul",
      channel: "email",
      direction: "inbound",
      requiresReply: true,
      body: "Can you share a resume?",
    });

    createCompany(fixture.client.db, fixture.tenantB, {
      id: "hidden-co",
      name: "Hidden Co",
    });
    createContact(fixture.client.db, fixture.tenantB, {
      id: "b-rahul",
      name: "Rahul Sharma",
      companyId: "hidden-co",
    });
    updateContact(fixture.client.db, fixture.tenantB, "b-rahul", {
      nextAction: "Follow up about Microsoft openings",
      followUpOn: asOfA,
    });
    createOpportunity(fixture.client.db, fixture.tenantB, {
      id: "hidden-sde",
      companyId: "hidden-co",
      role: "SDE",
    });
    const hiddenApplication = applyToOpportunity(
      fixture.client.db,
      fixture.tenantB,
      {
        id: "hidden-app",
        opportunityId: "hidden-sde",
        portal: "Hidden",
        appliedOn: asOfB,
      },
    );
    expect(hiddenApplication).toBeDefined();
    createInteraction(fixture.client.db, fixture.tenantB, {
      contactId: "b-rahul",
      channel: "email",
      direction: "inbound",
      requiresReply: true,
      body: "Private reply",
    });

    const a = getTodaySnapshot(fixture.client.db, fixture.tenantA, { now });
    const b = getTodaySnapshot(fixture.client.db, fixture.tenantB, { now });

    expect(a.asOfOn).toBe("2026-09-02");
    expect(a.stats.followUps).toBe(1);
    expect(a.stats.needReply).toBe(1);
    expect(a.stats.deadlines).toBe(1);
    expect(a.stats.interviewsToday).toBe(0);
    expect(a.pipeline).toEqual({
      saved: 1,
      referral: 1,
      applied: 0,
      oa: 0,
      interview: 0,
      offer: 0,
    });
    expect(a.doNow.map((row) => row.entityLabel)).toEqual(["Rahul Sharma"]);
    expect(
      a.activity.some((item) => item.headline.includes("Hidden Co")),
    ).toBe(false);
    expect(a.activity.length).toBeLessThanOrEqual(15);

    expect(b.asOfOn).toBe("2026-09-01");
    expect(b.doNow).toEqual([]);
    expect(b.stats.needReply).toBe(1);
    expect(b.pipeline.applied).toBe(1);
    expect(b.pipeline.saved).toBe(0);
    expect(b.pipeline.referral).toBe(0);
    expect(
      b.activity.some((item) => item.headline.includes("Microsoft")),
    ).toBe(false);
  });

  it("counts OA from the rolled-up application stage, not a second machine", () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "amazon",
      name: "Amazon",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "amazon-sde",
      companyId: "amazon",
      role: "SDE",
    });
    const application = applyToOpportunity(fixture.client.db, fixture.tenantA, {
      id: "amazon-app",
      opportunityId: "amazon-sde",
      portal: "Amazon",
      appliedOn: "2026-09-01",
    });
    expect(application).toBeDefined();
    updateApplication(fixture.client.db, fixture.tenantA, "amazon-app", {
      stage: "oa_received",
    });

    const snapshot = getTodaySnapshot(fixture.client.db, fixture.tenantA, {
      now,
    });
    expect(snapshot.pipeline).toMatchObject({
      saved: 0,
      applied: 0,
      oa: 1,
    });
  });
});

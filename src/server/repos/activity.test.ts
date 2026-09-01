import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { listActivity } from "./activity";
import { createCompany } from "./companies";
import { createContact } from "./contacts";
import { createOpportunity } from "./opportunities";
import { createReferral } from "./referrals";
import { createTask } from "./tasks";

describe("activity feed", () => {
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

  it("lists earlier company, contact, opportunity, referral, and task events for one workspace", () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
      now: new Date("2026-09-01T04:00:00.000Z"),
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      companyId: "microsoft",
      now: new Date("2026-09-01T05:00:00.000Z"),
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "microsoft-sde",
      companyId: "microsoft",
      role: "SDE",
      now: new Date("2026-09-01T06:00:00.000Z"),
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "rahul-referral",
      contactId: "rahul",
      opportunityId: "microsoft-sde",
      channel: "whatsapp",
      stage: "requested",
      now: new Date("2026-09-01T07:00:00.000Z"),
    });
    createTask(fixture.client.db, fixture.tenantA, {
      id: "prep",
      title: "Prepare system design",
      now: new Date("2026-09-01T08:00:00.000Z"),
    });
    createCompany(fixture.client.db, fixture.tenantB, {
      id: "hidden",
      name: "Hidden Co",
      now: new Date("2026-09-01T09:00:00.000Z"),
    });

    const feed = listActivity(fixture.client.db, fixture.tenantA, {
      timeZone: "Asia/Kolkata",
    });
    const kinds = feed.map((item) => item.kind);
    expect(kinds).toContain("COMPANY_CREATED");
    expect(kinds).toContain("CONTACT_CREATED");
    expect(kinds).toContain("OPPORTUNITY_CREATED");
    expect(kinds).toContain("REFERRAL_CREATED");
    expect(kinds).toContain("TASK_CREATED");
    expect(feed.map((item) => item.headline)).toContain(
      "Company created → Microsoft",
    );
    expect(feed.map((item) => item.headline)).toContain(
      "Contact created → Rahul Sharma",
    );
    expect(feed.map((item) => item.headline)).toContain(
      "Job saved → Microsoft SDE",
    );
    expect(feed.map((item) => item.headline)).toContain(
      "Referral requested → Rahul Sharma",
    );
    expect(feed.map((item) => item.headline)).toContain(
      "Task created → Prepare system design",
    );
    expect(feed.some((item) => item.headline.includes("Hidden Co"))).toBe(
      false,
    );

    const forCompany = listActivity(fixture.client.db, fixture.tenantA, {
      timeZone: "Asia/Kolkata",
      entityType: "company",
      entityId: "microsoft",
    });
    expect(forCompany.every((item) => item.entityId === "microsoft")).toBe(
      true,
    );

    const otherDay = listActivity(fixture.client.db, fixture.tenantA, {
      timeZone: "Asia/Kolkata",
      on: "2026-08-31",
    });
    expect(
      otherDay.every((item) => item.kind === "ACCOUNT_FOUNDATION_CREATED"),
    ).toBe(true);
  });
});

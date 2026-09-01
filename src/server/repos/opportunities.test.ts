import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createCompany } from "./companies";
import {
  OpportunityInputError,
  createOpportunity,
  getOpportunity,
  listOpportunities,
  updateOpportunity,
} from "./opportunities";

describe("opportunity repository", () => {
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

  it("round-trips every section 7 field", () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "google",
      name: "Google",
    });
    const expectedFields = {
      companyId: company.id,
      role: "Software Engineer",
      jobId: "123456",
      url: "https://careers.google.com/jobs/123456",
      location: "Bengaluru",
      workMode: "Hybrid",
      employmentType: "Full-time",
      experienceRequirement: "0-2 years",
      source: "Company careers page",
      discoveredOn: "2026-09-01",
      postedOn: "2026-08-29",
      deadlineOn: "2026-09-15",
      compensation: "INR 24 LPA",
      priority: "High",
      interestScore: 9,
      eligibility: "Eligible",
      referralPreferred: true,
      resumeVersionId: "resume-v1",
      jdSnapshot: "Build reliable distributed systems.",
      notes: "Ask for the team name.",
      tagsJson: ["backend", "new grad"],
      bucket: "saved",
      stage: "discovered",
      nextAction: "Find an alumnus",
    } as const;

    const created = createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-swe",
      ...expectedFields,
      tags: [...expectedFields.tagsJson],
      now: new Date("2026-09-01T12:00:00.000Z"),
    });
    const reloaded = getOpportunity(
      fixture.client.db,
      fixture.tenantA,
      created.id,
    );

    expect(reloaded).toBeDefined();
    for (const [field, expected] of Object.entries(expectedFields)) {
      expect(reloaded?.[field as keyof typeof reloaded], field).toEqual(expected);
    }
    expect(reloaded).toMatchObject({ companyName: "Google" });
  });

  it("filters saved and active jobs without crossing workspace boundaries", () => {
    const fixture = newFixture();
    const companyA = createCompany(fixture.client.db, fixture.tenantA, {
      id: "company-a",
      name: "Company A",
    });
    const companyB = createCompany(fixture.client.db, fixture.tenantB, {
      id: "company-b",
      name: "Company B",
    });
    const savedA = createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "saved-a",
      companyId: companyA.id,
      role: "Saved role",
      jobId: "same-job-id",
      bucket: "saved",
    });
    const activeA = createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "active-a",
      companyId: companyA.id,
      role: "Active role",
      bucket: "active",
      stage: "interested",
    });
    const savedB = createOpportunity(fixture.client.db, fixture.tenantB, {
      id: "saved-b",
      companyId: companyB.id,
      role: "Private role",
      jobId: "same-job-id",
      bucket: "saved",
    });

    expect(listOpportunities(fixture.client.db, fixture.tenantA, "saved")).toEqual([
      expect.objectContaining({ id: savedA.id }),
    ]);
    expect(listOpportunities(fixture.client.db, fixture.tenantA, "active")).toEqual([
      expect.objectContaining({ id: activeA.id }),
    ]);
    expect(listOpportunities(fixture.client.db, fixture.tenantA, "all")).toEqual([
      expect.objectContaining({ id: activeA.id }),
      expect.objectContaining({ id: savedA.id }),
    ]);
    expect(getOpportunity(fixture.client.db, fixture.tenantA, savedB.id)).toBe(
      undefined,
    );
  });

  it("requires an owned company and treats a foreign opportunity as not found", () => {
    const fixture = newFixture();
    const privateCompany = createCompany(fixture.client.db, fixture.tenantB, {
      id: "private-company",
      name: "Private Company",
    });
    const privateOpportunity = createOpportunity(
      fixture.client.db,
      fixture.tenantB,
      {
        id: "private-opportunity",
        companyId: privateCompany.id,
        role: "Private role",
      },
    );
    const beforeEvents = fixture.rowCount("activity_event");

    expect(() =>
      createOpportunity(fixture.client.db, fixture.tenantA, {
        companyId: privateCompany.id,
        role: "Cross-workspace role",
      }),
    ).toThrowError(OpportunityInputError);
    expect(
      updateOpportunity(
        fixture.client.db,
        fixture.tenantA,
        privateOpportunity.id,
        { role: "Leaked" },
      ),
    ).toBeUndefined();
    expect(fixture.rowCount("activity_event")).toBe(beforeEvents);
  });

  it("updates the bucket and selectable stage and logs both writes", () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "company-a",
      name: "Company A",
    });
    const created = createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "opportunity-a",
      companyId: company.id,
      role: "Software Engineer",
      now: new Date("2026-09-01T12:00:00.000Z"),
    });

    const updated = updateOpportunity(
      fixture.client.db,
      fixture.tenantA,
      created.id,
      { bucket: "active", stage: "interested" },
      new Date("2026-09-01T12:05:00.000Z"),
    );

    expect(updated).toMatchObject({ bucket: "active", stage: "interested" });
    expect(
      fixture.client.sqlite
        .prepare(
          "select kind from activity_event where workspace_id = ? and entity_type = 'opportunity' order by at",
        )
        .all(fixture.tenantA.workspaceId),
    ).toEqual([
      { kind: "OPPORTUNITY_CREATED" },
      { kind: "OPPORTUNITY_UPDATED" },
    ]);
    expect(() =>
      updateOpportunity(fixture.client.db, fixture.tenantA, created.id, {
        stage: "applied" as "interested",
      }),
    ).toThrowError(OpportunityInputError);
  });
});

import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createCompany } from "./companies";
import { createContact } from "./contacts";
import { createOpportunity } from "./opportunities";
import { createReferral } from "./referrals";
import {
  getScoredOpportunity,
  listScoredOpportunities,
} from "./scoring";
import { updateWorkspaceSettings } from "./settings";

describe("scoring repository", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  it("derives all six terms from explicit workspace-owned facts", () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "target-company",
      name: "Target Company",
      target: true,
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "referrer",
      companyId: company.id,
      name: "Synthetic Referrer",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "target-role",
      companyId: company.id,
      role: "Software Engineer",
      postedOn: "2026-09-02",
      experienceRequirement: "Graduate role · 3+ years",
      eligibility: "Not eligible — experience shortfall",
      tags: ["preferred location"],
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "received-referral",
      contactId: "referrer",
      opportunityId: "target-role",
      channel: "email",
      stage: "referral_received",
      todayOn: "2026-09-03",
    });

    expect(
      getScoredOpportunity(
        fixture.client.db,
        fixture.tenantA,
        "target-role",
        "2026-09-03",
      ),
    ).toMatchObject({
      score: 8,
      scoringInputs: {
        targetCompany: true,
        newGradRole: true,
        preferredLocation: true,
        referralAvailable: true,
        postedWithin48Hours: true,
        experienceExceedsEligibility: true,
      },
      terms: [
        { key: "targetCompany", weight: 3 },
        { key: "newGradRole", weight: 3 },
        { key: "preferredLocation", weight: 2 },
        { key: "referralAvailable", weight: 2 },
        { key: "postedWithin48Hours", weight: 1 },
        { key: "experienceExceedsEligibility", weight: -3 },
      ],
    });
  });

  it("sorts high scores first and re-sorts after a weight change", () => {
    const fixture = newFixture();
    const target = createCompany(fixture.client.db, fixture.tenantA, {
      id: "target",
      name: "Zeta Target",
      target: true,
    });
    const random = createCompany(fixture.client.db, fixture.tenantA, {
      id: "random",
      name: "Alpha Random",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "high",
      companyId: target.id,
      role: "New Grad Engineer",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "low",
      companyId: random.id,
      role: "Software Engineer",
    });

    expect(
      listScoredOpportunities(
        fixture.client.db,
        fixture.tenantA,
        { bucket: "all", sort: "score" },
        "2026-09-03",
      ).map(({ id, score }) => ({ id, score })),
    ).toEqual([
      { id: "high", score: 6 },
      { id: "low", score: 0 },
    ]);

    updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
      displayName: "Tenant A",
      scoringWeights: { targetCompany: -5, newGradRole: 0 },
    });
    expect(
      listScoredOpportunities(
        fixture.client.db,
        fixture.tenantA,
        { bucket: "all", sort: "score" },
        "2026-09-03",
      ).map(({ id, score }) => ({ id, score })),
    ).toEqual([
      { id: "low", score: 0 },
      { id: "high", score: -5 },
    ]);
  });

  it("never reads another workspace's weights, inputs, or opportunities", () => {
    const fixture = newFixture();
    const companyA = createCompany(fixture.client.db, fixture.tenantA, {
      id: "company-a",
      name: "Company A",
      target: true,
    });
    const companyB = createCompany(fixture.client.db, fixture.tenantB, {
      id: "company-b",
      name: "Private Company B",
      target: true,
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "opportunity-a",
      companyId: companyA.id,
      role: "New Grad Engineer",
    });
    createOpportunity(fixture.client.db, fixture.tenantB, {
      id: "opportunity-b",
      companyId: companyB.id,
      role: "New Grad Engineer",
    });
    updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
      displayName: "Tenant A",
      scoringWeights: { targetCompany: 1 },
    });
    updateWorkspaceSettings(fixture.client.db, fixture.tenantB, {
      displayName: "Tenant B",
      scoringWeights: { targetCompany: 99 },
    });

    expect(
      listScoredOpportunities(
        fixture.client.db,
        fixture.tenantA,
        { bucket: "all", sort: "score" },
        "2026-09-03",
      ),
    ).toEqual([
      expect.objectContaining({ id: "opportunity-a", score: 4 }),
    ]);
    expect(
      getScoredOpportunity(
        fixture.client.db,
        fixture.tenantA,
        "opportunity-b",
        "2026-09-03",
      ),
    ).toBeUndefined();
  });
});

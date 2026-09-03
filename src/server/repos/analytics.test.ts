import { afterEach, describe, expect, it } from "vitest";

import { ANALYTICS_EMPTY, ANALYTICS_HONESTY } from "../../domain/analytics";
import { applyToOpportunity, updateApplication } from "./applications";
import { getAnalyticsSnapshot, getCompanyConversionStats } from "./analytics";
import { createCompany } from "./companies";
import { createContact } from "./contacts";
import { createInteraction } from "./interactions";
import { createInterview } from "./interviews";
import { createOpportunity } from "./opportunities";
import { createReferral } from "./referrals";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import type { ApplicationStage } from "../../domain/application";
import type { TenantContext } from "../db/tenant";
import type { AppDatabase } from "../db/client";

function seedCountedWorkspace(
  database: AppDatabase,
  tenant: TenantContext,
  prefix: string,
  options: {
    applications: number;
    receivedReferrals?: number;
    oa?: number;
    interviews?: number;
    offers?: number;
    whatsappOutbound?: number;
  },
) {
  const company = createCompany(database, tenant, {
    id: `${prefix}-company`,
    name: `${prefix} Company`,
  });
  createContact(database, tenant, {
    id: `${prefix}-contact`,
    name: `${prefix} Contact`,
    companyId: company.id,
  });

  for (let index = 0; index < options.applications; index += 1) {
    const opportunityId = `${prefix}-role-${index + 1}`;
    createOpportunity(database, tenant, {
      id: opportunityId,
      companyId: company.id,
      role: `${prefix} Role ${index + 1}`,
      bucket: "active",
    });
    const application = applyToOpportunity(database, tenant, {
      id: `${prefix}-app-${index + 1}`,
      opportunityId,
      portal: "Company site",
      appliedOn: "2026-09-01",
    });
    let stage: ApplicationStage = "applied";
    if (index < (options.offers ?? 0)) {
      stage = "offer";
    } else if (index < (options.oa ?? 0)) {
      stage = "oa_received";
    }
    if (application && stage !== "applied") {
      updateApplication(database, tenant, application.id, { stage });
    }
    if (index < (options.receivedReferrals ?? 0)) {
      createReferral(database, tenant, {
        id: `${prefix}-ref-${index + 1}`,
        contactId: `${prefix}-contact`,
        opportunityId,
        channel: "whatsapp",
        stage: "referral_received",
        todayOn: "2026-09-03",
      });
    }
    if (index < (options.interviews ?? 0)) {
      createInterview(database, tenant, {
        id: `${prefix}-interview-${index + 1}`,
        opportunityId,
        kind: "Coding",
      });
    }
  }

  for (let index = 0; index < (options.whatsappOutbound ?? 0); index += 1) {
    createInteraction(database, tenant, {
      id: `${prefix}-wa-${index + 1}`,
      contactId: `${prefix}-contact`,
      companyId: company.id,
      channel: "whatsapp",
      direction: "outbound",
      body: "Checking for openings.",
    });
  }

  return company;
}

describe("analytics repository", () => {
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

  it("returns the empty sentence on a fresh workspace", () => {
    const fixture = newFixture();
    const snapshot = getAnalyticsSnapshot(
      fixture.client.db,
      fixture.tenantA,
    );

    expect(snapshot.empty).toBe(true);
    expect(snapshot.emptyCopy).toBe(ANALYTICS_EMPTY);
    expect(snapshot.funnel.every((step) => step.rate.percent === null)).toBe(
      true,
    );
  });

  it("keeps workspace B from changing A's counts or unhiding a rate", () => {
    const fixture = newFixture();
    seedCountedWorkspace(fixture.client.db, fixture.tenantA, "visible", {
      applications: 3,
      receivedReferrals: 1,
      oa: 1,
      interviews: 1,
      whatsappOutbound: 2,
    });
    seedCountedWorkspace(fixture.client.db, fixture.tenantB, "hidden", {
      applications: 8,
      receivedReferrals: 4,
      oa: 3,
      interviews: 2,
      offers: 1,
      whatsappOutbound: 5,
    });

    const snapshotA = getAnalyticsSnapshot(
      fixture.client.db,
      fixture.tenantA,
    );
    const snapshotB = getAnalyticsSnapshot(
      fixture.client.db,
      fixture.tenantB,
    );

    expect(snapshotA.empty).toBe(false);
    expect(
      snapshotA.funnel.find((step) => step.key === "applications")?.count,
    ).toBe(3);
    expect(
      snapshotA.funnel.find((step) => step.key === "oa")?.rate,
    ).toMatchObject({
      suppressed: true,
      label: ANALYTICS_HONESTY,
      percent: null,
    });
    expect(JSON.stringify(snapshotA)).not.toContain("hidden");
    expect(JSON.stringify(snapshotA)).not.toContain("Hidden");

    expect(
      snapshotB.funnel.find((step) => step.key === "applications")?.count,
    ).toBe(8);
    expect(
      snapshotB.funnel.find((step) => step.key === "oa")?.rate.suppressed,
    ).toBe(false);
    expect(snapshotA.channels.some((row) => row.channel === "whatsapp")).toBe(
      true,
    );
    expect(
      snapshotA.channels.find((row) => row.channel === "whatsapp")?.attempts,
    ).toBe(2);
  });

  it("leaves A empty when only B has applications", () => {
    const fixture = newFixture();
    seedCountedWorkspace(fixture.client.db, fixture.tenantB, "hidden", {
      applications: 6,
      oa: 2,
    });

    const snapshotA = getAnalyticsSnapshot(
      fixture.client.db,
      fixture.tenantA,
    );
    expect(snapshotA.empty).toBe(true);
    expect(snapshotA.emptyCopy).toBe(ANALYTICS_EMPTY);
    expect(
      snapshotA.funnel.find((step) => step.key === "applications")?.count,
    ).toBe(0);
  });

  it("counts company conversion rows for the owning workspace only", () => {
    const fixture = newFixture();
    const microsoft = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createCompany(fixture.client.db, fixture.tenantB, {
      id: "microsoft-b",
      name: "Microsoft",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      companyId: microsoft.id,
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      name: "Priya Nair",
      companyId: microsoft.id,
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "msft-sde",
      companyId: microsoft.id,
      role: "SDE",
      bucket: "active",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "msft-saved",
      companyId: microsoft.id,
      role: "PM intern",
      bucket: "saved",
    });
    applyToOpportunity(fixture.client.db, fixture.tenantA, {
      id: "msft-app",
      opportunityId: "msft-sde",
      portal: "Careers",
      appliedOn: "2026-09-01",
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "msft-ref-asked",
      contactId: "rahul",
      opportunityId: "msft-sde",
      channel: "whatsapp",
      stage: "requested",
      todayOn: "2026-09-03",
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "msft-ref-got",
      contactId: "priya",
      opportunityId: "msft-sde",
      channel: "email",
      stage: "referral_received",
      todayOn: "2026-09-03",
    });
    createInterview(fixture.client.db, fixture.tenantA, {
      id: "msft-interview",
      opportunityId: "msft-sde",
      kind: "Coding",
    });
    createOpportunity(fixture.client.db, fixture.tenantB, {
      id: "msft-hidden",
      companyId: "microsoft-b",
      role: "Hidden role",
      bucket: "active",
    });
    applyToOpportunity(fixture.client.db, fixture.tenantB, {
      opportunityId: "msft-hidden",
      portal: "Hidden",
      appliedOn: "2026-09-01",
    });

    expect(
      getCompanyConversionStats(
        fixture.client.db,
        fixture.tenantA,
        microsoft.id,
      ),
    ).toEqual({
      activeOpportunities: 1,
      applications: 1,
      contacts: 2,
      referralRequests: 2,
      referralsReceived: 1,
      interviews: 1,
    });
    expect(
      getCompanyConversionStats(
        fixture.client.db,
        fixture.tenantA,
        "missing",
      ),
    ).toBeUndefined();
    expect(
      getCompanyConversionStats(
        fixture.client.db,
        fixture.tenantA,
        "microsoft-b",
      ),
    ).toBeUndefined();
    expect(
      getCompanyConversionStats(
        fixture.client.db,
        fixture.tenantB,
        "microsoft-b",
      ),
    ).toEqual({
      activeOpportunities: 1,
      applications: 1,
      contacts: 0,
      referralRequests: 0,
      referralsReceived: 0,
      interviews: 0,
    });
  });
});

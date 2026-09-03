import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANALYTICS_EMPTY } from "../domain/analytics";
import { applyToOpportunity, updateApplication } from "../server/repos/applications";
import { createCompany } from "../server/repos/companies";
import { createContact } from "../server/repos/contacts";
import { createInteraction } from "../server/repos/interactions";
import { createInterview } from "../server/repos/interviews";
import { createOpportunity } from "../server/repos/opportunities";
import { createReferral } from "../server/repos/referrals";
import { createTenantTestFixture } from "../test/tenant-fixture";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: undefined as unknown,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/server/auth/current-session", () => ({
  requireTenant: async () => mocks.tenant,
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));

import AnalyticsPage from "./(app)/analytics/page";

describe("analytics screen", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
    return fixture;
  }

  beforeEach(() => {
    mocks.database = undefined;
    mocks.tenant = undefined;
  });

  it("names the empty sentence instead of 0% bars", async () => {
    newFixture();
    const html = renderToStaticMarkup(await AnalyticsPage());

    expect(html).toContain(ANALYTICS_EMPTY);
    expect(html).not.toContain("0%");
    expect(html).not.toContain("Coming later");
    expect(html).not.toContain("This screen is not built yet.");
  });

  it("renders the funnel, honesty cutoff, slices, and stacked channel cards", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "visible-co",
      name: "Visible Co",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      companyId: company.id,
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "referred-role",
      companyId: company.id,
      role: "Referred SDE",
      bucket: "active",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "cold-role",
      companyId: company.id,
      role: "Cold SDE",
      bucket: "active",
    });
    const referred = applyToOpportunity(fixture.client.db, fixture.tenantA, {
      opportunityId: "referred-role",
      portal: "Careers",
      appliedOn: "2026-09-01",
    });
    applyToOpportunity(fixture.client.db, fixture.tenantA, {
      opportunityId: "cold-role",
      portal: "Careers",
      appliedOn: "2026-09-01",
    });
    if (referred) {
      updateApplication(fixture.client.db, fixture.tenantA, referred.id, {
        stage: "oa_received",
      });
    }
    createReferral(fixture.client.db, fixture.tenantA, {
      contactId: "rahul",
      opportunityId: "referred-role",
      channel: "whatsapp",
      stage: "referral_received",
      todayOn: "2026-09-03",
    });
    createInterview(fixture.client.db, fixture.tenantA, {
      opportunityId: "referred-role",
      kind: "Coding",
    });
    createInteraction(fixture.client.db, fixture.tenantA, {
      contactId: "rahul",
      companyId: company.id,
      channel: "whatsapp",
      direction: "outbound",
      body: "Hi Rahul, checking for openings.",
    });
    createInteraction(fixture.client.db, fixture.tenantA, {
      contactId: "rahul",
      companyId: company.id,
      channel: "whatsapp",
      direction: "inbound",
      body: "Yes, I can refer you.",
    });

    const hidden = createCompany(fixture.client.db, fixture.tenantB, {
      id: "hidden-co",
      name: "Hidden Co",
    });
    for (let index = 0; index < 6; index += 1) {
      createOpportunity(fixture.client.db, fixture.tenantB, {
        id: `hidden-role-${index + 1}`,
        companyId: hidden.id,
        role: `Hidden role ${index + 1}`,
        bucket: "active",
      });
      applyToOpportunity(fixture.client.db, fixture.tenantB, {
        opportunityId: `hidden-role-${index + 1}`,
        portal: "Hidden",
        appliedOn: "2026-09-01",
      });
    }

    const html = renderToStaticMarkup(await AnalyticsPage());

    expect(html).toContain("Opportunities pursued");
    expect(html).toContain("Referral applications");
    expect(html).toContain("Cold applications");
    expect(html).toContain("WhatsApp");
    expect(html).toContain("n &lt; 5 — not enough data");
    expect(html).toContain('class="tbl channel-table"');
    expect(html).toContain('class="channel-card-list"');
    expect(html).not.toContain("Hidden Co");
    expect(html).not.toContain("0%");
  });
});

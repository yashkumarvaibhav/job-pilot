import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyToOpportunity } from "../server/repos/applications";
import { createCompany } from "../server/repos/companies";
import { createOpportunity } from "../server/repos/opportunities";
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

import ApplicationsPage from "./(app)/applications/page";

describe("application screens", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
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

  it("names the empty state that points at Mark applied", async () => {
    newFixture();
    const html = renderToStaticMarkup(await ApplicationsPage());
    expect(html).toContain("No applications. Mark an opportunity as applied.");
  });

  it("lists the row with a link to the opportunity application block", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "google",
      name: "Google",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-swe",
      companyId: company.id,
      role: "Software Engineer",
    });
    applyToOpportunity(fixture.client.db, fixture.tenantA, {
      opportunityId: "google-swe",
      portal: "Greenhouse",
      appliedOn: "2026-09-01",
    });

    const html = renderToStaticMarkup(await ApplicationsPage());
    expect(html).toContain("Google");
    expect(html).toContain("Software Engineer");
    expect(html).toContain("Greenhouse");
    expect(html).toContain("2026-09-01");
    expect(html).toContain('href="/opportunities/google-swe#application"');
    expect(html).toContain('class="tbl application-table"');
    expect(html).toContain('class="application-card-list"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Applied");
  });
});

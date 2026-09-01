import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../test/tenant-fixture";
import { createCompany } from "../server/repos/companies";

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

import CompaniesPage from "./(app)/companies/page";
import CompanyDetailPage from "./(app)/companies/[id]/page";

describe("company screens", () => {
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

  it("names what will appear when the company list is empty", async () => {
    newFixture();

    const html = renderToStaticMarkup(await CompaniesPage());

    expect(html).toContain(
      "No companies yet. Add one to hang contacts and roles on.",
    );
    expect(html).toContain("Add company");
  });

  it("renders both desktop table and mobile card treatments with target text and icon", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
      industry: "Technology",
      target: true,
    });

    const html = renderToStaticMarkup(await CompaniesPage());

    expect(html).toContain('class="tbl company-table"');
    expect(html).toContain('class="company-card-list"');
    expect(html).toContain("Microsoft");
    expect(html).toContain("Technology");
    expect(html).toContain("Target");
    expect(html).toContain('aria-hidden="true"');
  });

  it("renders every company field and the zero-count summaries on detail", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
      website: "https://microsoft.com",
      careersUrl: "https://careers.microsoft.com",
      industry: "Technology",
      type: "Product",
      locations: "Bengaluru",
      notes: "Target roles in cloud engineering.",
      target: true,
    });

    const html = renderToStaticMarkup(
      await CompanyDetailPage({ params: Promise.resolve({ id: "microsoft" }) }),
    );

    for (const expected of [
      "https://microsoft.com",
      "https://careers.microsoft.com",
      "Technology",
      "Product",
      "Bengaluru",
      "Target roles in cloud engineering.",
      "Contacts",
      "Open roles",
      "Applications",
      "Referrals",
      "Interviews",
      "Edit company",
    ]) {
      expect(html).toContain(expected);
    }
  });

  it("uses the same Company not found state for missing and foreign ids", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantB, {
      id: "company-b",
      name: "Private Company",
    });

    for (const id of ["missing", "company-b"]) {
      const html = renderToStaticMarkup(
        await CompanyDetailPage({ params: Promise.resolve({ id }) }),
      );
      expect(html).toContain("Company not found");
      expect(html).not.toContain("Private Company");
    }
  });
});

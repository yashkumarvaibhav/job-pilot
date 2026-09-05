import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../test/tenant-fixture";
import { applyToOpportunity } from "../server/repos/applications";
import { createCompany } from "../server/repos/companies";
import { createContact } from "../server/repos/contacts";
import { createInterview } from "../server/repos/interviews";
import { createOpportunity } from "../server/repos/opportunities";
import { createReferral } from "../server/repos/referrals";

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

    expect(html).toContain("Conversion statistics");
    for (const expected of [
      "https://microsoft.com",
      "https://careers.microsoft.com",
      "Technology",
      "Product",
      "Bengaluru",
      "Target roles in cloud engineering.",
      "Active opportunities",
      "Applications",
      "Contacts",
      "Referral requests",
      "Referrals received",
      "Interviews",
      "Edit company",
      "Delete company",
      "Linked records are preserved",
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

  it("shows the six conversion counts next to the rows that produce them", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      companyId: "microsoft",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "msft-sde",
      companyId: "microsoft",
      role: "SDE",
      bucket: "active",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "msft-saved",
      companyId: "microsoft",
      role: "Saved intern",
      bucket: "saved",
    });
    applyToOpportunity(fixture.client.db, fixture.tenantA, {
      opportunityId: "msft-sde",
      portal: "Careers",
      appliedOn: "2026-09-01",
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "msft-ref",
      contactId: "rahul",
      opportunityId: "msft-sde",
      channel: "whatsapp",
      stage: "referral_received",
      todayOn: "2026-09-03",
    });
    createInterview(fixture.client.db, fixture.tenantA, {
      opportunityId: "msft-sde",
      kind: "Coding",
    });
    createCompany(fixture.client.db, fixture.tenantB, {
      id: "hidden-co",
      name: "Hidden Co",
    });
    createOpportunity(fixture.client.db, fixture.tenantB, {
      id: "hidden-role",
      companyId: "hidden-co",
      role: "Hidden role",
      bucket: "active",
    });

    const html = renderToStaticMarkup(
      await CompanyDetailPage({
        params: Promise.resolve({ id: "microsoft" }),
      }),
    );

    expect(html).toContain("Active opportunities");
    expect(html).toContain("Referral requests");
    expect(html).toContain("Referrals received");
    expect(html).toContain("Rahul Sharma");
    expect(html).toContain("SDE");
    expect(html).toContain("Saved intern");
    expect(html).toContain("Coding");
    expect(html).not.toContain("Hidden Co");
    expect(html).not.toContain("Hidden role");
    expect(html).toMatch(/Active opportunities[\s\S]*?>1</);
    expect(html).toMatch(/Applications[\s\S]*?>1</);
    expect(html).toMatch(/Contacts[\s\S]*?>1</);
    expect(html).toMatch(/Referral requests[\s\S]*?>1</);
    expect(html).toMatch(/Referrals received[\s\S]*?>1</);
    expect(html).toMatch(/Interviews[\s\S]*?>1</);
  });
});

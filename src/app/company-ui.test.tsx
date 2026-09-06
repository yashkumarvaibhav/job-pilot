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

  it("renders live scoped contact navigation in desktop and mobile company lists", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
      industry: "Technology",
      target: true,
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      companyId: "microsoft",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      name: "Priya Nair",
      companyId: "microsoft",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "microsoft-ai",
      companyId: "microsoft",
      role: "AI Engineer",
      bucket: "active",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "microsoft-sde",
      companyId: "microsoft",
      role: "SDE",
      bucket: "active",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "microsoft-saved",
      companyId: "microsoft",
      role: "Saved role",
      bucket: "saved",
    });
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "exl",
      name: "EXL",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "mudassir",
      name: "Mudassir Jamil",
      companyId: "exl",
    });
    createCompany(fixture.client.db, fixture.tenantB, {
      id: "private-microsoft",
      name: "Microsoft",
    });
    createContact(fixture.client.db, fixture.tenantB, {
      id: "hidden-contact",
      name: "Hidden Contact",
      companyId: "private-microsoft",
    });
    createOpportunity(fixture.client.db, fixture.tenantB, {
      id: "hidden-role",
      companyId: "private-microsoft",
      role: "Hidden Role",
      bucket: "active",
    });

    const html = renderToStaticMarkup(await CompaniesPage());

    expect(html).toContain('class="tbl company-table"');
    expect(html).toContain('class="company-card-list"');
    expect(html).toContain("Microsoft");
    expect(html).toContain("Technology");
    expect(html).toContain("Target");
    expect(html.match(/>2 contacts</g)).toHaveLength(2);
    expect(html.match(/>1 contact</g)).toHaveLength(2);
    expect(html.match(/>2 open roles</g)).toHaveLength(2);
    expect(
      html.match(/href="\/companies\/microsoft#company-contacts"/g),
    ).toHaveLength(2);
    expect(html.match(/href="\/companies\/exl#company-contacts"/g)).toHaveLength(
      2,
    );
    expect(
      html.match(/href="\/companies\/microsoft#company-opportunities"/g),
    ).toHaveLength(2);
    expect(html).not.toContain("3 contacts");
    expect(html).not.toContain("3 open roles");
    expect(html).not.toContain("Hidden Contact");
    expect(html).not.toContain("Hidden Role");
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
      url: "https://careers.microsoft.com/jobs/sde",
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
    expect(html).toContain('id="company-contacts"');
    expect(html).toContain('href="/contacts/rahul"');
    expect(html).toContain("SDE");
    expect(html).toContain("Saved intern");
    expect(html).toContain(
      'href="/opportunities?company=microsoft&amp;add=1"',
    );
    expect(html).toContain("Add role / post");
    expect(html).toContain(
      'href="https://careers.microsoft.com/jobs/sde"',
    );
    expect(html).toContain("Open job post");
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

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyToOpportunity, updateApplication } from "../server/repos/applications";
import { createCompany } from "../server/repos/companies";
import { createContact } from "../server/repos/contacts";
import { createOpportunity, linkContactToOpportunity } from "../server/repos/opportunities";
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

import OpportunityDetailPage from "./(app)/opportunities/[id]/page";
import OpportunitiesPage from "./(app)/opportunities/page";

describe("opportunity screens", () => {
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

  it("names the empty state and requires a company in the add form", async () => {
    newFixture();
    const html = renderToStaticMarkup(
      await OpportunitiesPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("No opportunities. Paste a job URL or add one");
    expect(html).toContain("Add job");
    expect(html).toContain("Add a company before adding a job");
  });

  it("renders Saved, Active, and All filters plus desktop and mobile treatments", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "google",
      name: "Google",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-swe",
      companyId: company.id,
      role: "Software Engineer",
      jobId: "123456",
      bucket: "saved",
    });

    const html = renderToStaticMarkup(
      await OpportunitiesPage({
        searchParams: Promise.resolve({ bucket: "saved" }),
      }),
    );
    expect(html).toContain("Saved");
    expect(html).toContain("Active");
    expect(html).toContain("All");
    expect(html).toContain('class="tbl opportunity-table"');
    expect(html).toContain('class="opportunity-card-list"');
    expect(html).toContain("Software Engineer");
    expect(html).toContain("123456");
    expect(html).toContain('aria-hidden="true"');
  });

  it("renders persisted detail fields and only pursuit stages in the edit form", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "google",
      name: "Google",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-swe",
      companyId: company.id,
      role: "Software Engineer",
      compensation: "INR 24 LPA",
      interestScore: 9,
      referralPreferred: true,
      jdSnapshot: "Build reliable distributed systems.",
      stage: "interested",
    });

    const html = renderToStaticMarkup(
      await OpportunityDetailPage({
        params: Promise.resolve({ id: "google-swe" }),
      }),
    );
    for (const expected of [
      "Google",
      "Software Engineer",
      "INR 24 LPA",
      "9",
      "Referral preferred",
      "Build reliable distributed systems.",
      "Interested",
      "Ready to Apply",
      "No Longer Interested",
    ]) {
      expect(html).toContain(expected);
    }
    expect(html).not.toContain("OA Received");
    expect(html).not.toContain("Interview Scheduled");
    expect(html).not.toContain("Offer</option>");
    expect(html).toContain("Linked contacts");
    expect(html).toContain("No contacts linked to this opening yet.");
    expect(html).toContain("Every contact is already linked, or none exist yet.");
    expect(html).toContain("Mark applied");
    expect(html).toContain("Pursuit stage");
    expect(html).toContain('id="application"');
  });

  it("lists a linked contact and the remaining picker on opportunity detail", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "google",
      name: "Google",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: company.id,
      name: "Rahul Sharma",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      name: "Priya Nair",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-swe",
      companyId: company.id,
      role: "Software Engineer",
    });
    linkContactToOpportunity(
      fixture.client.db,
      fixture.tenantA,
      "google-swe",
      "rahul",
    );

    const html = renderToStaticMarkup(
      await OpportunityDetailPage({
        params: Promise.resolve({ id: "google-swe" }),
      }),
    );

    expect(html).toContain("Linked contacts");
    expect(html).toContain("Rahul Sharma");
    expect(html).toContain('href="/contacts/rahul"');
    expect(html).toContain("contact-table");
    expect(html).toContain("contact-card-list");
    expect(html).toContain("Link contact");
    expect(html).toContain("Priya Nair");
    expect(html).not.toContain("No contacts linked to this opening yet.");
  });

  it("uses the same not-found state for missing and foreign ids", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantB, {
      id: "company-b",
      name: "Private Company",
    });
    createOpportunity(fixture.client.db, fixture.tenantB, {
      id: "opportunity-b",
      companyId: company.id,
      role: "Private Role",
    });

    for (const id of ["missing", "opportunity-b"]) {
      const html = renderToStaticMarkup(
        await OpportunityDetailPage({ params: Promise.resolve({ id }) }),
      );
      expect(html).toContain("Opportunity not found");
      expect(html).not.toContain("Private Role");
    }
  });

  it("rolls the header chip up to the application stage after apply", async () => {
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
    const created = applyToOpportunity(fixture.client.db, fixture.tenantA, {
      opportunityId: "google-swe",
      portal: "Greenhouse",
      appliedOn: "2026-09-01",
    });
    updateApplication(fixture.client.db, fixture.tenantA, created!.id, {
      stage: "under_review",
    });

    const html = renderToStaticMarkup(
      await OpportunityDetailPage({
        params: Promise.resolve({ id: "google-swe" }),
      }),
    );

    expect(html).toContain("Under Review");
    expect(html).toContain("Application stage");
    expect(html).toContain("Greenhouse");
    expect(html).toContain("Save application");
    expect(html).not.toContain("Mark applied");
  });
});

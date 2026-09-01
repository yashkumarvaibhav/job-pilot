import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCompany } from "../server/repos/companies";
import { createContact } from "../server/repos/contacts";
import { attachTag } from "../server/repos/tags";
import { createTenantTestFixture } from "../test/tenant-fixture";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: undefined as unknown,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/companies/microsoft",
}));
vi.mock("@/server/auth/current-session", () => ({
  requireTenant: async () => mocks.tenant,
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));

import CompanyDetailPage from "./(app)/companies/[id]/page";
import ContactDetailPage from "./(app)/contacts/[id]/page";

describe("tag screens", () => {
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

  it("shows the tag picker and attached labels on company and contact pages", async () => {
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
    attachTag(fixture.client.db, fixture.tenantA, {
      label: "Dream Company",
      entityType: "company",
      entityId: "microsoft",
    });
    attachTag(fixture.client.db, fixture.tenantA, {
      label: "Alumni Available",
      entityType: "contact",
      entityId: "rahul",
    });

    const companyHtml = renderToStaticMarkup(
      await CompanyDetailPage({
        params: Promise.resolve({ id: "microsoft" }),
      }),
    );
    expect(companyHtml).toContain("Dream Company");
    expect(companyHtml).toContain("Add tag");
    expect(companyHtml).toContain("Activity");

    const contactHtml = renderToStaticMarkup(
      await ContactDetailPage({
        params: Promise.resolve({ id: "rahul" }),
      }),
    );
    expect(contactHtml).toContain("Alumni Available");
    expect(contactHtml).toContain("Add tag");
  });
});

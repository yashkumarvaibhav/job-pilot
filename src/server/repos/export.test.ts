import { afterEach, describe, expect, it } from "vitest";

import { parseCsv } from "../../domain/csv-import";
import { parseExportQuery } from "../../domain/export";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { applyToOpportunity } from "./applications";
import { createCompany } from "./companies";
import { createContact } from "./contacts";
import { buildWorkspaceExport } from "./export";
import { createOpportunity } from "./opportunities";

describe("workspace export", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function seed() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    const now = new Date("2026-09-02T10:00:00.000Z");
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
      now,
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: "microsoft",
      name: "Rahul Sharma",
      methods: [{ kind: "email", value: "rahul@invalid.test", isPrimary: true }],
      now,
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "sde",
      companyId: "microsoft",
      role: "SDE",
      jobId: "182763",
      now,
    });
    applyToOpportunity(fixture.client.db, fixture.tenantA, {
      id: "app-1",
      opportunityId: "sde",
      portal: "Careers",
      appliedOn: "2026-09-01",
      now,
    });
    createCompany(fixture.client.db, fixture.tenantB, {
      id: "hidden-co",
      name: "Hidden Co",
      now,
    });
    createContact(fixture.client.db, fixture.tenantB, {
      id: "hidden-contact",
      companyId: "hidden-co",
      name: "Other Person",
      methods: [{ kind: "email", value: "other@invalid.test", isPrimary: true }],
      now,
    });
    return { fixture, now };
  }

  it("puts a contact email in JSON and CSV and keeps the other workspace out", () => {
    const { fixture, now } = seed();
    const json = buildWorkspaceExport(
      fixture.client.db,
      fixture.tenantA,
      parseExportQuery(new URLSearchParams("format=json&set=all")),
      now,
    );
    const payload = JSON.parse(json.body) as {
      companies: Array<{ name: string }>;
      contacts: Array<{ name: string; email: string }>;
    };

    expect(payload.companies.map((row) => row.name)).toEqual(["Microsoft"]);
    expect(payload.contacts[0]).toMatchObject({
      name: "Rahul Sharma",
      email: "rahul@invalid.test",
    });
    expect(json.body).not.toContain("Hidden Co");
    expect(json.body).not.toContain("other@invalid.test");
    expect(json.body).not.toContain("passwordHash");
    expect(json.body).not.toContain("password_hash");
    expect(json.body).not.toContain("APP_PASSWORD");
    expect(json.body).not.toContain("synthetic-password-hash");
    expect(json.body).not.toContain("workspaceId");
    expect(json.body).not.toContain("workspace-b");

    const csv = buildWorkspaceExport(
      fixture.client.db,
      fixture.tenantA,
      parseExportQuery(new URLSearchParams("format=csv&set=contacts")),
      now,
    );
    const parsed = parseCsv(csv.body);
    expect(parsed.headers[0]).toBe("Name");
    expect(parsed.headers).toContain("Email");
    expect(parsed.rows[0]?.values).toContain("rahul@invalid.test");
    expect(csv.body).not.toContain("other@invalid.test");
  });

  it("does not copy APP_PASSWORD or the other workspace's rows into an export", () => {
    const { fixture, now } = seed();
    const previous = process.env.APP_PASSWORD;
    process.env.APP_PASSWORD = "env-password-must-not-leak";
    try {
      const json = buildWorkspaceExport(
        fixture.client.db,
        fixture.tenantA,
        parseExportQuery(new URLSearchParams("format=json&set=all")),
        now,
      );
      expect(json.body).toContain("rahul@invalid.test");
      expect(json.body).not.toContain("APP_PASSWORD");
      expect(json.body).not.toContain("env-password-must-not-leak");
    } finally {
      if (previous === undefined) {
        delete process.env.APP_PASSWORD;
      } else {
        process.env.APP_PASSWORD = previous;
      }
    }
  });
});

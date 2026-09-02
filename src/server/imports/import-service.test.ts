import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createCompany } from "../repos/companies";
import { createContact } from "../repos/contacts";
import { createOpportunity } from "../repos/opportunities";
import { executeImport, planImport, type ImportRequest } from "./import-service";

describe("CSV import apply", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  function apply(
    fixture: ReturnType<typeof createTenantTestFixture>,
    request: Omit<ImportRequest, "dryRun">,
  ) {
    return executeImport(fixture.client.db, fixture.tenantA, {
      ...request,
      dryRun: false,
    });
  }

  function fixtureCsv(name: "companies" | "contacts" | "opportunities") {
    return readFileSync(
      new URL(`../../test/fixtures/import/${name}.csv`, import.meta.url),
      "utf8",
    );
  }

  it("creates valid companies, skips bad and exact duplicate rows, and makes re-import idempotent", () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, { name: "Existing" });
    const request = {
      entitySet: "companies" as const,
      csv: fixtureCsv("companies"),
      mapping: { name: "Company", website: "Website", notes: "Notes" },
      createMissingCompanies: false,
    };
    const beforeEvents = fixture.rowCount("activity_event");

    expect(apply(fixture, request)).toMatchObject({
      dryRun: false,
      summary: { created: 1, warned: 0, skipped: 3 },
      rows: [
        { line: 2, status: "skipped" },
        { line: 3, status: "created" },
        { line: 4, status: "skipped" },
        { line: 5, status: "skipped" },
      ],
    });
    expect(fixture.rowCount("company")).toBe(2);
    expect(fixture.rowCount("activity_event") - beforeEvents).toBe(1);

    expect(apply(fixture, request).summary).toEqual({
      created: 0,
      warned: 0,
      skipped: 4,
    });
    expect(fixture.rowCount("company")).toBe(2);
  });

  it("names a job-ID candidate on dry run and creates a second row only with a per-row override", () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      name: "Microsoft",
    });
    const original = createOpportunity(fixture.client.db, fixture.tenantA, {
      companyId: company.id,
      role: "SDE",
      jobId: "182763",
    });
    const request = {
      entitySet: "opportunities" as const,
      csv: "Company,Role,Job ID\nMicrosoft,SDE,182763",
      mapping: { company: "Company", role: "Role", jobId: "Job ID" },
      createMissingCompanies: false,
    };

    const planned = planImport(fixture.client.db, fixture.tenantA, {
      ...request,
      dryRun: true,
    });
    expect(planned.rows[0]).toMatchObject({
      line: 2,
      status: "would-warn",
      reason: expect.stringContaining("This job may already be tracked."),
      candidates: [{ id: original.id, label: "Microsoft · SDE" }],
    });
    expect(apply(fixture, request).summary).toEqual({
      created: 0,
      warned: 0,
      skipped: 1,
    });
    expect(fixture.rowCount("opportunity")).toBe(1);

    const overridden = apply(fixture, { ...request, overrideLines: [2] });
    expect(overridden.summary).toEqual({ created: 0, warned: 1, skipped: 0 });
    expect(fixture.rowCount("opportunity")).toBe(2);
    const payload = fixture.client.sqlite
      .prepare(
        "select payload_json as payload from activity_event where kind = 'OPPORTUNITY_CREATED' order by at desc limit 1",
      )
      .get() as { payload: string };
    expect(JSON.parse(payload.payload)).toMatchObject({
      duplicateOverride: true,
      candidateIds: [original.id],
    });
  });

  it("reports later exact duplicates inside one dry-run file", () => {
    const fixture = newFixture();

    const cases: ImportRequest[] = [
      {
        entitySet: "companies",
        dryRun: true,
        csv: "Name\nAcme\nAcme",
        mapping: { name: "Name" },
        createMissingCompanies: false,
      },
      {
        entitySet: "contacts",
        dryRun: true,
        csv: "Name,Email\nOne,SAME@invalid.test\nTwo,same@invalid.test",
        mapping: { name: "Name", email: "Email" },
        createMissingCompanies: false,
      },
    ];
    const acme = createCompany(fixture.client.db, fixture.tenantA, {
      name: "Opportunity Co",
    });
    void acme;
    cases.push({
      entitySet: "opportunities",
      dryRun: true,
      csv: "Company,Role,Job ID\nOpportunity Co,One,J-1\nOpportunity Co,Two,J-1",
      mapping: { company: "Company", role: "Role", jobId: "Job ID" },
      createMissingCompanies: false,
    });

    for (const request of cases) {
      const result = planImport(fixture.client.db, fixture.tenantA, request);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].status).toBe("would-create");
      expect(result.rows[1]).toMatchObject({
        line: 3,
        status: "would-skip",
      });
      expect(result.rows[1].reason).toContain("earlier CSV row");
    }
  });

  it("imports a contact and missing company in one row without seeing another workspace's email", () => {
    const fixture = newFixture();
    const privateCompany = createCompany(fixture.client.db, fixture.tenantB, {
      name: "Private Co",
    });
    createContact(fixture.client.db, fixture.tenantB, {
      companyId: privateCompany.id,
      name: "Private Person",
      methods: [{ kind: "email", value: "same@invalid.test", isPrimary: true }],
    });
    const beforeEvents = fixture.rowCount("activity_event");

    const result = apply(fixture, {
      entitySet: "contacts",
      csv: fixtureCsv("contacts"),
      mapping: { name: "Name", email: "Email", company: "Company" },
      createMissingCompanies: true,
    });

    expect(result).toMatchObject({
      summary: { created: 0, warned: 1, skipped: 2 },
      rows: [
        { line: 2, status: "created-with-warning" },
        { line: 3, status: "skipped" },
        { line: 4, status: "skipped", reason: "Contact name is required." },
      ],
    });
    expect(
      fixture.client.sqlite
        .prepare("select count(*) as count from company where workspace_id = ? and name = 'New Company'")
        .get(fixture.tenantA.workspaceId),
    ).toEqual({ count: 1 });
    expect(
      fixture.client.sqlite
        .prepare("select count(*) as count from company where workspace_id = ? and name = 'Half Company'")
        .get(fixture.tenantA.workspaceId),
    ).toEqual({ count: 0 });
    expect(fixture.rowCount("activity_event") - beforeEvents).toBe(2);
  });

  it("scopes company plus job-ID duplicates and obeys missing-company policy", () => {
    const fixture = newFixture();
    const companyA = createCompany(fixture.client.db, fixture.tenantA, {
      name: "Acme",
    });
    const companyB = createCompany(fixture.client.db, fixture.tenantB, {
      name: "Acme",
    });
    createOpportunity(fixture.client.db, fixture.tenantB, {
      companyId: companyB.id,
      role: "Engineer",
      jobId: "J-1",
    });

    const common = {
      entitySet: "opportunities" as const,
      csv: fixtureCsv("opportunities"),
      mapping: { company: "Company", role: "Role", jobId: "Job ID" },
    };
    expect(apply(fixture, { ...common, createMissingCompanies: false })).toMatchObject({
      summary: { created: 1, warned: 0, skipped: 2 },
    });
    expect(
      fixture.client.sqlite
        .prepare("select count(*) as count from opportunity where workspace_id = ? and company_id = ?")
        .get(fixture.tenantA.workspaceId, companyA.id),
    ).toEqual({ count: 1 });

    const warned = apply(fixture, { ...common, createMissingCompanies: true });
    expect(warned.summary).toEqual({ created: 0, warned: 1, skipped: 2 });
    expect(warned.rows[1]).toMatchObject({
      line: 3,
      status: "created-with-warning",
    });
  });
});

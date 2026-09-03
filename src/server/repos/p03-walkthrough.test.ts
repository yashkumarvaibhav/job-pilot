import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { opportunityHealth } from "../../domain/opportunity-health";
import { parseExportQuery } from "../../domain/export";
import { calendarDateInZone, shiftCalendarDate } from "../../domain/referral";
import { savedSearchHref } from "../../domain/saved-search";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { applyToOpportunity, listApplications } from "./applications";
import { getAnalyticsSnapshot } from "./analytics";
import { createCompany, getCompany, listCompanies } from "./companies";
import { getContact, listContacts } from "./contacts";
import { buildWorkspaceExport } from "./export";
import { executeImport, planImport } from "../imports/import-service";
import {
  createOpportunity,
  getOpportunity,
  listOpportunities,
  parseOpportunityListFilter,
  updateOpportunity,
} from "./opportunities";
import { loadPaletteCatalog, searchPaletteEntities } from "./palette";
import { listStaleIndex } from "./rules";
import { getScoredOpportunity } from "./scoring";
import { listSavedSearches, saveSavedSearch } from "./saved-searches";
import { getTodaySnapshot } from "./today";

describe("P03 walkthrough", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  const now = new Date("2026-09-03T08:30:00.000Z");
  const staleAt = new Date("2026-08-13T08:30:00.000Z");

  it("owns a single import route", () => {
    expect(readdirSync(join(process.cwd(), "src/app/api"))).toContain("import");
    expect(
      readdirSync(join(process.cwd(), "src/app/api")).filter((name) =>
        name.includes("import"),
      ),
    ).toEqual(["import"]);
  });

  it("round-trips import, stale health, analytics, and saved search inside one workspace", () => {
    const fixture = newFixture();
    const db = fixture.client.db;
    const a = fixture.tenantA;
    const b = fixture.tenantB;
    const asOfOn = calendarDateInZone("Asia/Kolkata", now);
    const deadlineOn = shiftCalendarDate(asOfOn, 2);

    const tables = fixture.client.sqlite
      .prepare("select name from sqlite_master where type = 'table'")
      .all() as { name: string }[];
    expect(tables.some((row) => /gmail|oauth/i.test(row.name))).toBe(false);

    const amiCsv = [
      "Name,Email,Company,Designation,Relationship,Status,Id",
      "Ami Shah,ami@invalid.test,Uber,,,,",
    ].join("\n");
    const amiRequest = {
      entitySet: "contacts" as const,
      csv: amiCsv,
      mapping: { name: "Name", email: "Email", company: "Company" },
      createMissingCompanies: true,
    };

    const contactsBefore = listContacts(db, a).length;
    const companiesBefore = listCompanies(db, a).length;
    const eventsBefore = fixture.rowCount("activity_event");
    const plannedAmi = planImport(db, a, { ...amiRequest, dryRun: true });
    expect(plannedAmi.dryRun).toBe(true);
    expect(plannedAmi.summary).toEqual({
      wouldCreate: 1,
      wouldWarn: 0,
      wouldSkip: 0,
    });
    expect(plannedAmi.rows[0]).toMatchObject({
      line: 2,
      status: "would-create",
    });
    expect(listContacts(db, a)).toHaveLength(contactsBefore);
    expect(listCompanies(db, a)).toHaveLength(companiesBefore);
    expect(fixture.rowCount("activity_event")).toBe(eventsBefore);

    expect(
      executeImport(db, a, { ...amiRequest, dryRun: false }).summary,
    ).toEqual({ created: 1, warned: 0, skipped: 0 });
    const ami = listContacts(db, a).find((row) => row.name === "Ami Shah");
    expect(ami?.companyName).toBe("Uber");
    expect(listContacts(db, a).filter((row) => row.name === "Ami Shah")).toHaveLength(
      1,
    );

    const repeat = executeImport(db, a, { ...amiRequest, dryRun: false });
    expect(repeat.summary).toEqual({ created: 0, warned: 0, skipped: 1 });
    expect(repeat.rows[0]?.reason).toContain("ami@invalid.test");
    expect(listContacts(db, a).filter((row) => row.name === "Ami Shah")).toHaveLength(
      1,
    );

    const exported = buildWorkspaceExport(
      db,
      a,
      parseExportQuery(new URLSearchParams("format=csv&set=contacts")),
      now,
    );
    expect(exported.body).toContain("ami@invalid.test");
    const exportReimport = executeImport(db, a, {
      entitySet: "contacts",
      dryRun: false,
      csv: exported.body,
      mapping: { name: "Name", email: "Email", company: "Company" },
      createMissingCompanies: true,
    });
    expect(exportReimport.summary.created).toBe(0);
    expect(exportReimport.summary.skipped).toBeGreaterThan(0);
    expect(listContacts(db, a).filter((row) => row.name === "Ami Shah")).toHaveLength(
      1,
    );

    const uber = listCompanies(db, a).find((row) => row.name === "Uber");
    expect(uber).toBeDefined();
    const tracked = createOpportunity(db, a, {
      id: "uber-sde",
      companyId: uber!.id,
      role: "SDE",
      jobId: "UBER-101",
      bucket: "active",
      now,
    });
    const duplicateJob = planImport(db, a, {
      entitySet: "opportunities",
      dryRun: true,
      csv: "Company,Role,Job ID\nUber,SDE II,UBER-101",
      mapping: { company: "Company", role: "Role", jobId: "Job ID" },
      createMissingCompanies: false,
    });
    expect(duplicateJob.rows[0]).toMatchObject({
      status: "would-warn",
      reason: expect.stringContaining("This job may already be tracked."),
    });
    expect(
      executeImport(db, a, {
        entitySet: "opportunities",
        dryRun: false,
        csv: "Company,Role,Job ID\nUber,SDE II,UBER-101",
        mapping: { company: "Company", role: "Role", jobId: "Job ID" },
        createMissingCompanies: false,
      }).summary,
    ).toEqual({ created: 0, warned: 0, skipped: 1 });
    expect(listOpportunities(db, a, "all")).toHaveLength(1);
    expect(getOpportunity(db, a, tracked.id)?.jobId).toBe("UBER-101");

    const silent = createOpportunity(db, a, {
      id: "silent-role",
      companyId: uber!.id,
      role: "Platform Engineer",
      bucket: "active",
      now: staleAt,
    });
    const staleBeforeDeadline = listStaleIndex(db, a, asOfOn).opportunity.get(
      silent.id,
    );
    expect(
      staleBeforeDeadline?.some((mark) =>
        mark.reason.startsWith("No activity for"),
      ),
    ).toBe(true);
    expect(
      listOpportunities(
        db,
        a,
        parseOpportunityListFilter(new URLSearchParams("stale=1"), asOfOn),
      ).map((row) => row.id),
    ).toEqual([silent.id]);

    updateOpportunity(db, a, silent.id, { deadlineOn }, now);
    const health = opportunityHealth(
      {
        deadlineOn,
        hasApplication: false,
        referralAvailable: false,
      },
      asOfOn,
    );
    expect(health?.title).toBe("Deadline soon");
    expect(health?.sentence).toBe(`Apply before ${deadlineOn}.`);
    const scored = getScoredOpportunity(db, a, silent.id, asOfOn);
    expect(scored?.score).toEqual(expect.any(Number));
    expect(
      listStaleIndex(db, a, asOfOn).opportunity.get(silent.id)?.some((mark) =>
        mark.reason.includes("Job deadline"),
      ),
    ).toBe(true);

    const staleFilter = parseOpportunityListFilter(
      new URLSearchParams("stale=1"),
      asOfOn,
    );
    expect(staleFilter).toMatchObject({ stale: true, asOfOn });
    expect(
      listOpportunities(db, a, staleFilter).map((row) => row.id),
    ).toEqual([silent.id]);

    const saved = saveSavedSearch(db, a, {
      name: "Stale Opportunities",
      entityType: "opportunities",
      query: "stale=1",
      now,
    });
    expect(savedSearchHref(saved.entityType, saved.query)).toBe(
      "/opportunities?stale=1",
    );
    expect(
      listSavedSearches(db, a, "opportunities").some(
        (row) => row.name === "Stale Opportunities" && row.query === "stale=1",
      ),
    ).toBe(true);

    applyToOpportunity(db, a, {
      opportunityId: tracked.id,
      portal: "Careers",
      appliedOn: asOfOn,
      now,
    });
    const analytics = getAnalyticsSnapshot(db, a);
    expect(analytics.empty).toBe(false);
    expect(
      analytics.funnel.find((step) => step.key === "applications")?.count,
    ).toBe(1);
    expect(analytics.funnel.some((step) => step.rate.suppressed)).toBe(true);

    const today = getTodaySnapshot(db, a, { now });
    expect(today.asOfOn).toBe(asOfOn);

    const amiHits = searchPaletteEntities(db, a, "Ami");
    expect(amiHits.contacts.map((row) => row.name)).toEqual(["Ami Shah"]);
    const catalog = loadPaletteCatalog(db, a, "Stale");
    expect(
      catalog.savedSearches.some((row) => row.name === "Stale Opportunities"),
    ).toBe(true);
    expect(catalog.contacts.map((row) => row.name)).not.toContain("Ami Shah");

    expect(listCompanies(db, b)).toEqual([]);
    expect(listContacts(db, b)).toEqual([]);
    expect(listOpportunities(db, b, "all")).toEqual([]);
    expect(listApplications(db, b)).toEqual([]);
    expect(getContact(db, b, ami!.id)).toBeUndefined();
    expect(getOpportunity(db, b, silent.id)).toBeUndefined();
    expect(getCompany(db, b, uber!.id)).toBeUndefined();
    expect(searchPaletteEntities(db, b, "Ami").contacts).toEqual([]);
    expect(getAnalyticsSnapshot(db, b).empty).toBe(true);
    expect(getTodaySnapshot(db, b, { now }).doNow).toEqual([]);
    expect(
      listSavedSearches(db, b).some(
        (row) => row.query === "stale=1" && row.id === saved.id,
      ),
    ).toBe(false);
    expect(getContact(db, a, ami!.id)?.name).toBe("Ami Shah");
  });
});

import { afterEach, describe, expect, it } from "vitest";

import { createCompany } from "./companies";
import { createContact } from "./contacts";
import { createOpportunity } from "./opportunities";
import { loadPaletteCatalog, searchPaletteEntities } from "./palette";
import {
  deleteSavedSearch,
  getSavedSearch,
  listSavedSearches,
  saveSavedSearch,
} from "./saved-searches";
import { createTenantTestFixture } from "../../test/tenant-fixture";

describe("saved searches and palette search", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  it("seeds expressible names per workspace and restores a filled query", () => {
    const fixture = newFixture();
    const seeded = listSavedSearches(fixture.client.db, fixture.tenantA);
    expect(seeded.map((row) => row.name)).toEqual([
      "Checking for Openings",
      "Follow-ups",
      "High Priority",
      "Need Reply",
      "Referral Pending",
    ]);
    expect(seeded.every((row) => row.query === "")).toBe(true);

    const saved = saveSavedSearch(fixture.client.db, fixture.tenantA, {
      name: "High Priority",
      entityType: "opportunities",
      query: "priority=High&workspace=other",
    });
    expect(saved.query).toBe("priority=High");
    expect(
      listSavedSearches(fixture.client.db, fixture.tenantA, "opportunities").map(
        (row) => row.query,
      ),
    ).toEqual(["priority=High"]);

    const again = listSavedSearches(fixture.client.db, fixture.tenantA);
    expect(again.filter((row) => row.name === "High Priority")).toHaveLength(1);
  });

  it("hides another workspace's saved search and entity hits", () => {
    const fixture = newFixture();
    saveSavedSearch(fixture.client.db, fixture.tenantB, {
      id: "private-search",
      name: "Secret Filter",
      entityType: "contacts",
      query: "status=waiting_for_reply",
    });
    createCompany(fixture.client.db, fixture.tenantB, {
      id: "private-co",
      name: "Rahul Labs",
    });
    createContact(fixture.client.db, fixture.tenantB, {
      id: "private-rahul",
      name: "Rahul Sharma",
    });
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
      id: "ms-sde",
      companyId: "microsoft",
      role: "SDE",
    });

    expect(getSavedSearch(fixture.client.db, fixture.tenantA, "private-search")).toBeUndefined();
    expect(
      listSavedSearches(fixture.client.db, fixture.tenantA).map((row) => row.name),
    ).not.toContain("Secret Filter");
    expect(deleteSavedSearch(fixture.client.db, fixture.tenantA, "private-search")).toBe(
      false,
    );

    const hits = searchPaletteEntities(fixture.client.db, fixture.tenantA, "Rahul");
    expect(hits.contacts.map((row) => row.id)).toEqual(["rahul"]);
    expect(hits.companies.map((row) => row.id)).toEqual([]);
    expect(hits.opportunities).toEqual([]);

    const privateHits = searchPaletteEntities(
      fixture.client.db,
      fixture.tenantA,
      "Rahul Labs",
    );
    expect(privateHits.companies).toEqual([]);
    expect(privateHits.contacts).toEqual([]);

    const catalog = loadPaletteCatalog(fixture.client.db, fixture.tenantA, "SDE");
    expect(catalog.opportunities.map((row) => row.id)).toEqual(["ms-sde"]);
    expect(JSON.stringify(catalog)).not.toContain("private-");
    expect(JSON.stringify(catalog)).not.toContain("Secret Filter");
  });

  it("does not treat LIKE wildcards as match-all", () => {
    const fixture = newFixture();
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
    });
    expect(searchPaletteEntities(fixture.client.db, fixture.tenantA, "%").contacts).toEqual(
      [],
    );
    expect(searchPaletteEntities(fixture.client.db, fixture.tenantA, "_ahul").contacts).toEqual(
      [],
    );
  });
});

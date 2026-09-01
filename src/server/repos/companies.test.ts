import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import {
  createCompany,
  deleteCompany,
  getCompany,
  listCompanies,
  updateCompany,
} from "./companies";

describe("company repository", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  it("creates and lists only the current workspace's companies", () => {
    const fixture = newFixture();

    const companyA = createCompany(fixture.client.db, fixture.tenantA, {
      id: "company-a",
      name: "Same Company",
      website: "https://a.invalid.test",
      target: true,
      now: new Date("2026-09-01T06:00:00.000Z"),
    });
    const companyB = createCompany(fixture.client.db, fixture.tenantB, {
      id: "company-b",
      name: "Same Company",
      website: "https://b.invalid.test",
      now: new Date("2026-09-01T06:01:00.000Z"),
    });

    expect(listCompanies(fixture.client.db, fixture.tenantA)).toEqual([
      companyA,
    ]);
    expect(listCompanies(fixture.client.db, fixture.tenantB)).toEqual([
      companyB,
    ]);
    expect(getCompany(fixture.client.db, fixture.tenantA, companyB.id)).toBe(
      undefined,
    );
  });

  it("updates the owned row and logs create and update atomically", () => {
    const fixture = newFixture();
    const created = createCompany(fixture.client.db, fixture.tenantA, {
      id: "company-a",
      name: "Microsoft",
      careersUrl: "https://careers.microsoft.com",
      now: new Date("2026-09-01T06:00:00.000Z"),
    });

    const updated = updateCompany(
      fixture.client.db,
      fixture.tenantA,
      created.id,
      { industry: "Technology", locations: "Bengaluru, Hyderabad", target: true },
      new Date("2026-09-01T06:02:00.000Z"),
    );

    expect(updated).toMatchObject({
      id: created.id,
      industry: "Technology",
      locations: "Bengaluru, Hyderabad",
      target: true,
    });
    const events = fixture.client.sqlite
      .prepare(
        "select kind, entity_id from activity_event where workspace_id = ? and entity_type = 'company' order by at",
      )
      .all(fixture.tenantA.workspaceId);
    expect(events).toEqual([
      { kind: "COMPANY_CREATED", entity_id: created.id },
      { kind: "COMPANY_UPDATED", entity_id: created.id },
    ]);
  });

  it("treats a foreign id as missing without writing activity in either workspace", () => {
    const fixture = newFixture();
    const companyB = createCompany(fixture.client.db, fixture.tenantB, {
      id: "company-b",
      name: "Private Company",
    });
    const before = fixture.rowCount("activity_event");

    expect(
      updateCompany(fixture.client.db, fixture.tenantA, companyB.id, {
        notes: "Must not cross the boundary",
      }),
    ).toBeUndefined();
    expect(deleteCompany(fixture.client.db, fixture.tenantA, companyB.id)).toBe(
      false,
    );
    expect(fixture.rowCount("activity_event")).toBe(before);
    expect(getCompany(fixture.client.db, fixture.tenantB, companyB.id)).toEqual(
      companyB,
    );
  });

  it("deletes only an owned row and records that deletion", () => {
    const fixture = newFixture();
    const created = createCompany(fixture.client.db, fixture.tenantA, {
      id: "company-a",
      name: "Delete Me",
    });

    expect(deleteCompany(fixture.client.db, fixture.tenantA, created.id)).toBe(
      true,
    );
    expect(getCompany(fixture.client.db, fixture.tenantA, created.id)).toBe(
      undefined,
    );
    expect(
      fixture.client.sqlite
        .prepare(
          "select kind from activity_event where workspace_id = ? and entity_id = ? order by at desc limit 1",
        )
        .get(fixture.tenantA.workspaceId, created.id),
    ).toEqual({ kind: "COMPANY_DELETED" });
  });
});

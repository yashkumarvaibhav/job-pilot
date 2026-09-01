import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import {
  getImportMapping,
  saveImportMapping,
} from "./import-mappings";

describe("import mapping repository", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  it("remembers separate entity mappings inside each workspace", () => {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);

    saveImportMapping(
      fixture.client.db,
      fixture.tenantA,
      "companies",
      { name: "Company name", website: "Site" },
      new Date("2026-09-01T18:10:00.000Z"),
    );
    saveImportMapping(fixture.client.db, fixture.tenantA, "contacts", {
      name: "Full name",
      email: "Email",
    });
    saveImportMapping(fixture.client.db, fixture.tenantB, "companies", {
      name: "Organisation",
    });

    expect(getImportMapping(fixture.client.db, fixture.tenantA, "companies"))
      .toEqual({ name: "Company name", website: "Site" });
    expect(getImportMapping(fixture.client.db, fixture.tenantA, "contacts"))
      .toEqual({ name: "Full name", email: "Email" });
    expect(getImportMapping(fixture.client.db, fixture.tenantB, "companies"))
      .toEqual({ name: "Organisation" });
  });

  it("updates only the owned entity mapping", () => {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    saveImportMapping(fixture.client.db, fixture.tenantA, "companies", {
      name: "Old",
    });
    saveImportMapping(fixture.client.db, fixture.tenantB, "companies", {
      name: "Private",
    });

    saveImportMapping(fixture.client.db, fixture.tenantA, "companies", {
      name: "New",
    });

    expect(getImportMapping(fixture.client.db, fixture.tenantA, "companies"))
      .toEqual({ name: "New" });
    expect(getImportMapping(fixture.client.db, fixture.tenantB, "companies"))
      .toEqual({ name: "Private" });
  });
});

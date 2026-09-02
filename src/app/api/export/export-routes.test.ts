import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseCsv } from "../../../domain/csv-import";
import { createCompany } from "../../../server/repos/companies";
import { createContact } from "../../../server/repos/contacts";
import { createTenantTestFixture } from "../../../test/tenant-fixture";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: undefined as unknown,
}));

vi.mock("@/server/auth/current-session", () => ({
  currentTenant: async () => mocks.tenant,
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));

import { GET } from "./route";

const HOST = "https://jobpilot.invalid.test";

function get(query: string) {
  return GET(new Request(`${HOST}/api/export?${query}`));
}

describe("export route", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  beforeEach(() => {
    mocks.database = undefined;
    mocks.tenant = undefined;
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: "microsoft",
      name: "Rahul Sharma",
      methods: [{ kind: "email", value: "rahul@invalid.test", isPrimary: true }],
    });
    createCompany(fixture.client.db, fixture.tenantB, {
      id: "hidden",
      name: "Hidden Co",
    });
    return fixture;
  }

  it("refuses a signed-out export", async () => {
    newFixture();
    mocks.tenant = null;
    const response = await get("format=json&set=all");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required.",
    });
  });

  it("downloads JSON of the signed-in workspace only", async () => {
    newFixture();
    const response = await get("format=json&set=all");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toContain(
      'filename="job-pilot.json"',
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toContain("Microsoft");
    expect(body).toContain("Rahul Sharma");
    expect(body).toContain("rahul@invalid.test");
    expect(body).not.toContain("Hidden Co");
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("APP_PASSWORD");
  });

  it("downloads contacts CSV with a header row and the email cell", async () => {
    newFixture();
    const response = await get("format=csv&set=contacts");
    const body = await response.text();
    const parsed = parseCsv(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      'filename="job-pilot-contacts.csv"',
    );
    expect(parsed.headers[0]).toBe("Name");
    expect(parsed.rows[0]?.values).toContain("rahul@invalid.test");
  });

  it("explains a missing format instead of guessing", async () => {
    newFixture();
    const response = await get("set=all");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Choose JSON or CSV.",
    });
  });
});

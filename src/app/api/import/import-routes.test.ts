import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../../../test/tenant-fixture";
import { createCompany } from "../../../server/repos/companies";

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

import { GET, POST, PUT } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("import route", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  beforeEach(() => {
    delete process.env.JOB_PILOT_DEPLOYMENT_MODE;
    mocks.database = undefined;
    mocks.tenant = undefined;
  });

  it("refuses private import in demo mode even for a crafted request", async () => {
    newFixture();
    process.env.JOB_PILOT_DEPLOYMENT_MODE = "demo";

    const response = await POST(
      request({
        entitySet: "companies",
        dryRun: true,
        csv: "Name\nInjected",
        mapping: { name: "Name" },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Private CSV import is disabled in the public demo.",
    });
  });

  it("allows an authenticated workspace to import in public application mode", async () => {
    newFixture();
    process.env.JOB_PILOT_DEPLOYMENT_MODE = "public";

    const response = await POST(
      request({
        entitySet: "companies",
        dryRun: true,
        csv: "Name\nPublic Workspace Company",
        mapping: { name: "Name" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      dryRun: true,
      summary: { wouldCreate: 1, wouldWarn: 0, wouldSkip: 0 },
    });
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
    return fixture;
  }

  it("requires an authenticated workspace", async () => {
    newFixture();
    mocks.tenant = null;

    const response = await POST(
      request({
        entitySet: "companies",
        dryRun: true,
        csv: "Name\nAcme",
        mapping: { name: "Name" },
      }),
    );

    expect(response.status).toBe(401);
    expect(
      (await GET(
        new Request("http://localhost/api/import?entitySet=companies"),
      )).status,
    ).toBe(401);
  });

  it("saves and reloads an explicit mapping without exposing another workspace", async () => {
    const fixture = newFixture();
    const saved = await PUT(
      request({
        entitySet: "companies",
        mapping: { name: "Company", website: "Website" },
      }),
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      entitySet: "companies",
      mapping: { name: "Company", website: "Website" },
    });

    mocks.tenant = fixture.tenantB;
    const privateResponse = await GET(
      new Request("http://localhost/api/import?entitySet=companies"),
    );
    expect(await privateResponse.json()).toEqual({
      entitySet: "companies",
      fields: expect.any(Array),
      mapping: {},
    });

    mocks.tenant = fixture.tenantA;
    const ownedResponse = await GET(
      new Request("http://localhost/api/import?entitySet=companies"),
    );
    expect(await ownedResponse.json()).toEqual({
      entitySet: "companies",
      fields: expect.arrayContaining(["name", "website"]),
      mapping: { name: "Company", website: "Website" },
    });
  });

  it("plans every company row without writing and reports exact duplicate coverage", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      name: "Existing Co",
    });
    const before = {
      companies: fixture.rowCount("company"),
      events: fixture.rowCount("activity_event"),
    };

    const response = await POST(
      request({
        entitySet: "companies",
        dryRun: true,
        csv: [
          "Company,Website,Notes",
          "Existing Co,https://existing.invalid.test,duplicate",
          '"New, Incorporated",https://new.invalid.test,"quoted, note"',
          ",https://broken.invalid.test,missing name",
        ].join("\n"),
        mapping: {
          name: "Company",
          website: "Website",
          notes: "Notes",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      entitySet: "companies",
      dryRun: true,
      duplicateCheck:
        "Same name or same website/careers URL within your workspace. Apply skips a match unless you override that row.",
      summary: { wouldCreate: 1, wouldWarn: 1, wouldSkip: 1 },
      rows: [
        {
          line: 2,
          status: "would-warn",
          reason:
            'This company may already be tracked. Existing Co (same name).',
          candidates: [
            {
              id: expect.any(String),
              entityType: "company",
              label: "Existing Co",
              href: expect.stringMatching(/^\/companies\//),
              signals: ["same_name"],
            },
          ],
        },
        { line: 3, status: "would-create", reason: "Ready to import." },
        {
          line: 4,
          status: "would-skip",
          reason: "Company name is required.",
        },
      ],
    });
    expect({
      companies: fixture.rowCount("company"),
      events: fixture.rowCount("activity_event"),
    }).toEqual(before);
  });

  it("does not treat another workspace's identical company as a duplicate", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantB, {
      name: "Private Match",
    });

    const response = await POST(
      request({
        entitySet: "companies",
        dryRun: true,
        csv: "Company\nPrivate Match",
        mapping: { name: "Company" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      summary: { wouldCreate: 1, wouldWarn: 0, wouldSkip: 0 },
      rows: [{ line: 2, status: "would-create" }],
    });
  });

  it("applies valid rows and continues past a malformed row", async () => {
    const fixture = newFixture();
    const beforeEvents = fixture.rowCount("activity_event");
    const response = await POST(
      request({
        entitySet: "companies",
        dryRun: false,
        csv: "Company\nCreated Co\n",
        mapping: { name: "Company" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      dryRun: false,
      summary: { created: 1, warned: 0, skipped: 0 },
    });
    expect(fixture.rowCount("company")).toBe(1);
    expect(fixture.rowCount("activity_event") - beforeEvents).toBe(1);
  });

  it("rejects implicit mappings, writes, unknown fields and malformed CSV", async () => {
    const fixture = newFixture();

    for (const body of [
      { entitySet: "companies", dryRun: true, csv: "Name\nAcme" },
      {
        entitySet: "companies",
        dryRun: true,
        csv: "Name\nAcme",
        mapping: { name: "Name" },
        workspaceId: fixture.tenantB.workspaceId,
      },
      {
        entitySet: "companies",
        dryRun: true,
        csv: 'Name,Notes\nAcme,"unfinished',
        mapping: { name: "Name" },
      },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }
    expect(fixture.rowCount("company")).toBe(0);
  });
});

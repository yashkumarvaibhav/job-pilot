import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyToOpportunity } from "../../../server/repos/applications";
import { createCompany } from "../../../server/repos/companies";
import { createOpportunity } from "../../../server/repos/opportunities";
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

import { GET as listRoute, POST } from "./route";
import { GET as detailRoute, PATCH } from "./[id]/route";

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("application route handlers", () => {
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

  it("applies, lists, and updates without exposing workspace ids", async () => {
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

    const createdResponse = await POST(
      jsonRequest("http://localhost/api/applications", "POST", {
        opportunityId: "google-swe",
        portal: " Greenhouse ",
        appliedOn: "2026-09-01",
      }),
    );
    const created = (await createdResponse.json()) as Record<string, unknown>;

    expect(createdResponse.status).toBe(201);
    expect(created).toMatchObject({
      companyName: "Google",
      role: "Software Engineer",
      portal: "Greenhouse",
      stage: "applied",
    });
    expect(created).not.toHaveProperty("workspaceId");

    const listed = await listRoute();
    expect(await listed.json()).toEqual([created]);

    const second = await POST(
      jsonRequest("http://localhost/api/applications", "POST", {
        opportunityId: "google-swe",
        portal: "Lever",
        appliedOn: "2026-09-02",
      }),
    );
    expect(second.status).toBe(201);
    expect(await second.json()).toMatchObject({ id: created.id });
    expect(fixture.rowCount("application")).toBe(1);

    const updated = await PATCH(
      jsonRequest(
        `http://localhost/api/applications/${created.id as string}`,
        "PATCH",
        { stage: "under_review" },
      ),
      { params: Promise.resolve({ id: created.id as string }) },
    );
    expect(await updated.json()).toMatchObject({ stage: "under_review" });
  });

  it("returns the same not-found response for foreign ids and requires auth", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantB, {
      id: "company-b",
      name: "Private Company",
    });
    const foreignOpportunity = createOpportunity(
      fixture.client.db,
      fixture.tenantB,
      {
        id: "opportunity-b",
        companyId: company.id,
        role: "Private Role",
      },
    );
    const foreign = applyToOpportunity(fixture.client.db, fixture.tenantB, {
      opportunityId: foreignOpportunity.id,
      portal: "Workday",
      appliedOn: "2026-09-01",
    });
    const before = fixture.rowCount("activity_event");

    const missingOpportunity = await POST(
      jsonRequest("http://localhost/api/applications", "POST", {
        opportunityId: foreignOpportunity.id,
        portal: "Greenhouse",
        appliedOn: "2026-09-01",
      }),
    );
    expect(missingOpportunity.status).toBe(404);
    expect(await missingOpportunity.json()).toEqual({
      error: "Opportunity not found",
    });

    const missingApplication = await detailRoute(
      new Request(`http://localhost/api/applications/${foreign!.id}`),
      { params: Promise.resolve({ id: foreign!.id }) },
    );
    expect(missingApplication.status).toBe(404);
    expect(await missingApplication.json()).toEqual({
      error: "Application not found",
    });
    expect(fixture.rowCount("activity_event")).toBe(before);

    mocks.tenant = null;
    expect((await listRoute()).status).toBe(401);
  });
});

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

import { GET as listCompaniesRoute, POST } from "./route";
import {
  GET as getCompanyRoute,
  PUT,
} from "./[id]/route";

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("company route handlers", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
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

  it("creates, lists, reloads, and updates a company without exposing workspace ids", async () => {
    newFixture();

    const createdResponse = await POST(
      jsonRequest("http://localhost/api/companies", "POST", {
        name: " Microsoft ",
        careersUrl: "https://careers.microsoft.com",
        target: true,
      }),
    );
    const created = (await createdResponse.json()) as Record<string, unknown>;

    expect(createdResponse.status).toBe(201);
    expect(created).toMatchObject({
      name: "Microsoft",
      careersUrl: "https://careers.microsoft.com",
      target: true,
    });
    expect(created).not.toHaveProperty("workspaceId");

    const listResponse = await listCompaniesRoute();
    expect(await listResponse.json()).toEqual([created]);

    const updateResponse = await PUT(
      jsonRequest(
        `http://localhost/api/companies/${created.id as string}`,
        "PUT",
        { industry: "Technology", locations: "Bengaluru" },
      ),
      { params: Promise.resolve({ id: created.id as string }) },
    );
    expect(await updateResponse.json()).toMatchObject({
      id: created.id,
      industry: "Technology",
      locations: "Bengaluru",
    });

    const reloaded = await getCompanyRoute(
      new Request(`http://localhost/api/companies/${created.id as string}`),
      { params: Promise.resolve({ id: created.id as string }) },
    );
    expect(await reloaded.json()).toMatchObject({
      name: "Microsoft",
      industry: "Technology",
      target: true,
    });
  });

  it("returns one generic validation response for malformed or injected input", async () => {
    const fixture = newFixture();

    for (const body of [
      { name: "" },
      { name: "Valid", target: "yes" },
      { name: "Valid", website: "javascript:alert(1)" },
      { name: "Valid", workspaceId: fixture.tenantB.workspaceId },
    ]) {
      const response = await POST(
        jsonRequest("http://localhost/api/companies", "POST", body),
      );
      expect(response.status).toBe(400);
    }

    expect(fixture.rowCount("company")).toBe(0);
  });

  it("returns Company not found for a foreign id and writes no activity", async () => {
    const fixture = newFixture();
    const foreign = createCompany(fixture.client.db, fixture.tenantB, {
      id: "company-b",
      name: "Private Company",
    });
    const before = fixture.rowCount("activity_event");

    const readResponse = await getCompanyRoute(
      new Request(`http://localhost/api/companies/${foreign.id}`),
      { params: Promise.resolve({ id: foreign.id }) },
    );
    expect(readResponse.status).toBe(404);
    expect(await readResponse.json()).toEqual({ error: "Company not found" });

    const updateResponse = await PUT(
      jsonRequest(`http://localhost/api/companies/${foreign.id}`, "PUT", {
        notes: "Must not cross the boundary",
      }),
      { params: Promise.resolve({ id: foreign.id }) },
    );
    expect(updateResponse.status).toBe(404);
    expect(await updateResponse.json()).toEqual({ error: "Company not found" });
    expect(fixture.rowCount("activity_event")).toBe(before);
  });

  it("requires a validated session before reading or writing", async () => {
    newFixture();
    mocks.tenant = null;

    const listResponse = await listCompaniesRoute();
    const createResponse = await POST(
      jsonRequest("http://localhost/api/companies", "POST", {
        name: "No session",
      }),
    );

    expect(listResponse.status).toBe(401);
    expect(createResponse.status).toBe(401);
  });
});

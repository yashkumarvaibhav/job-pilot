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
import { DELETE, GET as detailRoute, PATCH } from "./[id]/route";

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("assessment route handlers", () => {
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

  it("creates, lists, completes, and deletes without exposing workspace ids", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "google",
      name: "Google",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-swe",
      companyId: "google",
      role: "SDE",
    });

    const createdResponse = await POST(
      jsonRequest("http://localhost/api/assessments", "POST", {
        opportunityId: "google-swe",
        kind: " Online Assessment ",
        platform: "HackerRank",
        dateOn: "2026-09-03",
        time: "18:00",
      }),
    );
    const created = (await createdResponse.json()) as Record<string, unknown>;

    expect(createdResponse.status).toBe(201);
    expect(created).toMatchObject({
      kind: "Online Assessment",
      platform: "HackerRank",
      companyName: "Google",
      role: "SDE",
      dueOn: "2026-09-03",
      status: "invited",
    });
    expect(created).not.toHaveProperty("workspaceId");

    const listed = await listRoute(
      jsonRequest(
        "http://localhost/api/assessments?opportunityId=google-swe",
        "GET",
      ),
    );
    expect(await listed.json()).toEqual([created]);

    const updated = await PATCH(
      jsonRequest(
        `http://localhost/api/assessments/${created.id as string}`,
        "PATCH",
        { status: "completed" },
      ),
      { params: Promise.resolve({ id: created.id as string }) },
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ status: "completed" });

    mocks.tenant = fixture.tenantB;
    const hidden = await detailRoute(
      jsonRequest(
        `http://localhost/api/assessments/${created.id as string}`,
        "GET",
      ),
      { params: Promise.resolve({ id: created.id as string }) },
    );
    expect(hidden.status).toBe(404);

    mocks.tenant = fixture.tenantA;
    const deleted = await DELETE(
      jsonRequest(
        `http://localhost/api/assessments/${created.id as string}`,
        "DELETE",
      ),
      { params: Promise.resolve({ id: created.id as string }) },
    );
    expect(deleted.status).toBe(204);
    expect(fixture.rowCount("assessment")).toBe(0);
  });

  it("rejects a supplied workspace id and a missing opportunity", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantB, {
      id: "hidden",
      name: "Hidden",
    });
    createOpportunity(fixture.client.db, fixture.tenantB, {
      id: "hidden-sde",
      companyId: "hidden",
      role: "SDE",
    });
    applyToOpportunity(fixture.client.db, fixture.tenantB, {
      id: "hidden-app",
      opportunityId: "hidden-sde",
      portal: "Hidden",
      appliedOn: "2026-09-01",
    });

    const injected = await POST(
      jsonRequest("http://localhost/api/assessments", "POST", {
        opportunityId: "google-swe",
        kind: "Online Assessment",
        workspaceId: fixture.tenantB.workspaceId,
      }),
    );
    expect(injected.status).toBe(400);

    const missing = await POST(
      jsonRequest("http://localhost/api/assessments", "POST", {
        opportunityId: "hidden-sde",
        kind: "Online Assessment",
      }),
    );
    expect(missing.status).toBe(404);
    expect(fixture.rowCount("assessment")).toBe(0);
  });

  it("rejects an unauthenticated write", async () => {
    mocks.tenant = undefined;
    const response = await POST(
      jsonRequest("http://localhost/api/assessments", "POST", {
        opportunityId: "google-swe",
        kind: "Online Assessment",
      }),
    );
    expect(response.status).toBe(401);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { GET as detailRoute, PUT } from "./[id]/route";

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("opportunity route handlers", () => {
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

  it("creates, filters, reloads, and updates without exposing workspace ids", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "google",
      name: "Google",
    });
    const createdResponse = await POST(
      jsonRequest("http://localhost/api/opportunities", "POST", {
        companyId: company.id,
        role: " Software Engineer ",
        jobId: "123456",
        bucket: "saved",
        compensation: "INR 24 LPA",
        interestScore: 9,
        referralPreferred: true,
      }),
    );
    const created = (await createdResponse.json()) as Record<string, unknown>;

    expect(createdResponse.status).toBe(201);
    expect(created).toMatchObject({
      companyName: "Google",
      role: "Software Engineer",
      bucket: "saved",
    });
    expect(created).not.toHaveProperty("workspaceId");

    const saved = await listRoute(
      new Request("http://localhost/api/opportunities?bucket=saved"),
    );
    expect(await saved.json()).toEqual([
      expect.objectContaining({ id: created.id, score: 0, terms: [] }),
    ]);
    const active = await listRoute(
      new Request("http://localhost/api/opportunities?bucket=active"),
    );
    expect(await active.json()).toEqual([]);

    const updated = await PUT(
      jsonRequest(
        `http://localhost/api/opportunities/${created.id as string}`,
        "PUT",
        { bucket: "active", stage: "interested", jdSnapshot: "Full JD" },
      ),
      { params: Promise.resolve({ id: created.id as string }) },
    );
    expect(await updated.json()).toMatchObject({
      bucket: "active",
      stage: "interested",
      jdSnapshot: "Full JD",
    });

    const reloaded = await detailRoute(
      new Request(`http://localhost/api/opportunities/${created.id as string}`),
      { params: Promise.resolve({ id: created.id as string }) },
    );
    expect(await reloaded.json()).toMatchObject({ role: "Software Engineer" });
  });

  it("rejects malformed, injected, post-apply, and foreign-company input", async () => {
    const fixture = newFixture();
    const foreignCompany = createCompany(fixture.client.db, fixture.tenantB, {
      id: "private-company",
      name: "Private Company",
    });

    for (const body of [
      { role: "Missing company" },
      { companyId: foreignCompany.id, role: "Private" },
      { companyId: "x", role: "Role", stage: "oa_received" },
      { companyId: "x", role: "Role", workspaceId: fixture.tenantB.workspaceId },
    ]) {
      const response = await POST(
        jsonRequest("http://localhost/api/opportunities", "POST", body),
      );
      expect(response.status).toBe(400);
    }
    expect(fixture.rowCount("opportunity")).toBe(0);
  });

  it("returns the same not-found response for foreign ids and requires auth", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantB, {
      id: "company-b",
      name: "Private Company",
    });
    const foreign = createOpportunity(fixture.client.db, fixture.tenantB, {
      id: "opportunity-b",
      companyId: company.id,
      role: "Private Role",
    });
    const before = fixture.rowCount("activity_event");

    const response = await detailRoute(
      new Request(`http://localhost/api/opportunities/${foreign.id}`),
      { params: Promise.resolve({ id: foreign.id }) },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Opportunity not found" });
    expect(fixture.rowCount("activity_event")).toBe(before);

    mocks.tenant = null;
    expect(
      (await listRoute(new Request("http://localhost/api/opportunities"))).status,
    ).toBe(401);
  });

  it("returns 409 for the same job ID and creates a second row on acknowledge", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    const original = createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "ms-sde",
      companyId: company.id,
      role: "SDE",
      jobId: "182763",
    });
    createOpportunity(fixture.client.db, fixture.tenantB, {
      id: "private",
      companyId: createCompany(fixture.client.db, fixture.tenantB, {
        id: "private-co",
        name: "Microsoft",
      }).id,
      role: "SDE",
      jobId: "182763",
    });

    const blocked = await POST(
      jsonRequest("http://localhost/api/opportunities", "POST", {
        companyId: company.id,
        role: "SDE",
        jobId: "182763",
      }),
    );
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({
      error: "This job may already be tracked.",
      candidates: [
        {
          id: original.id,
          entityType: "opportunity",
          label: "Microsoft · SDE",
          href: `/opportunities/${original.id}`,
          signals: ["same_company_job_id"],
        },
      ],
    });

    const created = await POST(
      jsonRequest("http://localhost/api/opportunities", "POST", {
        companyId: company.id,
        role: "SDE",
        jobId: "182763",
        acknowledgeDuplicates: true,
      }),
    );
    expect(created.status).toBe(201);
    expect(fixture.rowCount("opportunity")).toBe(3);
  });
});

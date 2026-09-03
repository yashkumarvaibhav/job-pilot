import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANALYTICS_EMPTY, ANALYTICS_HONESTY } from "../../../domain/analytics";
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

import { GET } from "./route";

describe("analytics route handlers", () => {
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

  it("returns the empty analytics payload without workspace ids", async () => {
    newFixture();

    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      empty: true,
      emptyCopy: ANALYTICS_EMPTY,
    });
    expect(body).not.toHaveProperty("workspaceId");
    expect(JSON.stringify(body)).not.toContain("workspace-");
  });

  it("keeps tenant B's volume from unhiding tenant A's rate", async () => {
    const fixture = newFixture();
    const companyA = createCompany(fixture.client.db, fixture.tenantA, {
      id: "visible-co",
      name: "Visible Co",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "visible-role",
      companyId: companyA.id,
      role: "Visible role",
      bucket: "active",
    });
    applyToOpportunity(fixture.client.db, fixture.tenantA, {
      opportunityId: "visible-role",
      portal: "Careers",
      appliedOn: "2026-09-01",
    });

    const companyB = createCompany(fixture.client.db, fixture.tenantB, {
      id: "hidden-co",
      name: "Hidden Co",
    });
    for (let index = 0; index < 6; index += 1) {
      createOpportunity(fixture.client.db, fixture.tenantB, {
        id: `hidden-role-${index + 1}`,
        companyId: companyB.id,
        role: `Hidden role ${index + 1}`,
        bucket: "active",
      });
      applyToOpportunity(fixture.client.db, fixture.tenantB, {
        opportunityId: `hidden-role-${index + 1}`,
        portal: "Hidden",
        appliedOn: "2026-09-01",
      });
    }

    const response = await GET();
    const body = (await response.json()) as {
      empty: boolean;
      funnel: Array<{ key: string; count: number; rate: { label: string | null } }>;
    };

    expect(body.empty).toBe(false);
    expect(body.funnel.find((step) => step.key === "applications")?.count).toBe(
      1,
    );
    expect(body.funnel.find((step) => step.key === "oa")).toMatchObject({
      count: 0,
      rate: { label: ANALYTICS_HONESTY },
    });
    expect(JSON.stringify(body)).not.toContain("Hidden");
    expect(JSON.stringify(body)).not.toContain("workspace-b");
  });

  it("rejects an unauthenticated analytics request", async () => {
    mocks.tenant = undefined;
    const response = await GET();
    expect(response.status).toBe(401);
  });
});

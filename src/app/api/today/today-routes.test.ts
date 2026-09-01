import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calendarDateInZone } from "../../../domain/referral";
import { createCompany } from "../../../server/repos/companies";
import { createContact, updateContact } from "../../../server/repos/contacts";
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

describe("today route handlers", () => {
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

  it("returns the workspace Today payload without workspace ids", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      companyId: "microsoft",
    });
    updateContact(fixture.client.db, fixture.tenantA, "rahul", {
      nextAction: "Follow up about Microsoft openings",
      followUpOn: calendarDateInZone("Asia/Kolkata"),
    });
    createCompany(fixture.client.db, fixture.tenantB, {
      id: "hidden-co",
      name: "Hidden Co",
    });

    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty("workspaceId");
    expect(body.stats).toMatchObject({
      followUps: expect.any(Number),
      needReply: 0,
    });
    const doNow = body.doNow as Array<Record<string, unknown>>;
    expect(doNow.some((row) => row.entityLabel === "Rahul Sharma")).toBe(
      true,
    );
    expect(JSON.stringify(body)).not.toContain("Hidden Co");
    expect(JSON.stringify(body)).not.toContain("workspace-b");
  });

  it("rejects an unauthenticated Today request", async () => {
    mocks.tenant = undefined;
    const response = await GET();
    expect(response.status).toBe(401);
  });
});

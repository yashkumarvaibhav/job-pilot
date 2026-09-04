import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../../../test/tenant-fixture";
import { addSuppressionEntry } from "../../../server/repos/send-safety";

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

import { DELETE } from "./[id]/route";

const NOW = new Date("2026-09-04T10:00:00.000Z");

describe("suppression delete route", () => {
  const fixtures: { dispose: () => void }[] = [];

  beforeEach(() => {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
  });

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  it("returns 409 on every write that tries to un-suppress a bounced address", async () => {
    const fixture = fixtures[0] as ReturnType<typeof createTenantTestFixture>;
    const bounced = addSuppressionEntry(fixture.client.db, fixture.tenantA, {
      email: "priya@invalid.test",
      reason: "bounced",
      sourceKey: "bounce:priya@invalid.test",
      now: NOW,
    });
    const response = await DELETE(new Request("https://jobpilot.invalid.test/api/suppression/x"), {
      params: Promise.resolve({ id: bounced.id }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Bounced addresses cannot be un-suppressed.",
    });
  });

  it("still removes a manual suppression", async () => {
    const fixture = fixtures[0] as ReturnType<typeof createTenantTestFixture>;
    const manual = addSuppressionEntry(fixture.client.db, fixture.tenantA, {
      email: "temp@invalid.test",
      reason: "manual",
      now: NOW,
    });
    const response = await DELETE(new Request("https://jobpilot.invalid.test/api/suppression/x"), {
      params: Promise.resolve({ id: manual.id }),
    });
    expect(response.status).toBe(200);
  });
});

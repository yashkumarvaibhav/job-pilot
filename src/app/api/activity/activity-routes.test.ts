import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCompany } from "../../../server/repos/companies";
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

function jsonRequest(url: string) {
  return new Request(url, { method: "GET" });
}

describe("activity route handlers", () => {
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

  it("returns the workspace feed without workspace ids", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createCompany(fixture.client.db, fixture.tenantB, {
      id: "hidden",
      name: "Hidden Co",
    });

    const response = await GET(
      jsonRequest("http://localhost/api/activity"),
    );
    const body = (await response.json()) as Array<Record<string, unknown>>;
    expect(response.status).toBe(200);
    expect(body.some((row) => row.headline === "Company created → Microsoft")).toBe(
      true,
    );
    expect(body.some((row) => String(row.headline).includes("Hidden Co"))).toBe(
      false,
    );
    expect(body[0]).not.toHaveProperty("workspaceId");
  });
});

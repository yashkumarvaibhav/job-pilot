import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCompany } from "../../server/repos/companies";
import { createContact } from "../../server/repos/contacts";
import { saveSavedSearch } from "../../server/repos/saved-searches";
import { createTenantTestFixture } from "../../test/tenant-fixture";

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

import { GET as paletteGet } from "./palette/route";
import {
  GET as listSavedSearchesRoute,
  POST as saveSearchRoute,
} from "./saved-searches/route";
import {
  DELETE as deleteSearchRoute,
  GET as getSearchRoute,
} from "./saved-searches/[id]/route";

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("palette and saved-search routes", () => {
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

  it("returns type-ahead hits and saved searches without workspace ids", async () => {
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
    createContact(fixture.client.db, fixture.tenantB, {
      id: "private-rahul",
      name: "Rahul Private",
    });
    saveSavedSearch(fixture.client.db, fixture.tenantB, {
      id: "private-search",
      name: "Secret Filter",
      entityType: "contacts",
      query: "status=waiting_for_reply",
    });

    const response = await paletteGet(
      jsonRequest("http://localhost/api/palette?q=Rahul", "GET"),
    );
    const body = (await response.json()) as {
      contacts: { id: string }[];
      savedSearches: { name: string; href: string }[];
    };
    expect(response.status).toBe(200);
    expect(body.contacts.map((row) => row.id)).toEqual(["rahul"]);
    expect(JSON.stringify(body)).not.toContain("workspaceId");
    expect(JSON.stringify(body)).not.toContain("private-");
    expect(body.savedSearches.map((row) => row.name)).toContain("High Priority");
    expect(body.savedSearches.map((row) => row.name)).not.toContain("Secret Filter");
  });

  it("treats another workspace's saved search id as not found", async () => {
    const fixture = newFixture();
    saveSavedSearch(fixture.client.db, fixture.tenantB, {
      id: "private-search",
      name: "Secret Filter",
      entityType: "opportunities",
      query: "priority=High",
    });

    const missing = await getSearchRoute(
      jsonRequest("http://localhost/api/saved-searches/private-search", "GET"),
      { params: Promise.resolve({ id: "private-search" }) },
    );
    expect(missing.status).toBe(404);
    expect(JSON.stringify(await missing.json())).not.toContain("workspaceId");

    const listed = await listSavedSearchesRoute(
      jsonRequest(
        "http://localhost/api/saved-searches?entityType=opportunities",
        "GET",
      ),
    );
    const rows = (await listed.json()) as { name: string; href: string }[];
    expect(rows.map((row) => row.name)).toEqual([
      "High Priority",
      "Stale Opportunities",
    ]);
    expect(rows.find((row) => row.name === "High Priority")?.href).toBe(
      "/opportunities",
    );
    expect(rows.find((row) => row.name === "Stale Opportunities")?.href).toBe(
      "/opportunities?stale=1",
    );

    const saved = await saveSearchRoute(
      jsonRequest("http://localhost/api/saved-searches", "POST", {
        name: "High Priority",
        entityType: "opportunities",
        query: "priority=High",
        workspaceId: fixture.tenantB.workspaceId,
      }),
    );
    expect(saved.status).toBe(201);
    const created = (await saved.json()) as { href: string; query: string };
    expect(created.href).toBe("/opportunities?priority=High");
    expect(created.query).toBe("priority=High");
    expect(created).not.toHaveProperty("workspaceId");

    const removed = await deleteSearchRoute(
      jsonRequest("http://localhost/api/saved-searches/private-search", "DELETE"),
      { params: Promise.resolve({ id: "private-search" }) },
    );
    expect(removed.status).toBe(404);
  });

  it("refuses unauthenticated palette access", async () => {
    mocks.tenant = undefined;
    const response = await paletteGet(
      jsonRequest("http://localhost/api/palette?q=Rahul", "GET"),
    );
    expect(response.status).toBe(401);
  });
});

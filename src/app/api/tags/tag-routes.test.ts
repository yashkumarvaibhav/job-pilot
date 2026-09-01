import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCompany } from "../../../server/repos/companies";
import { createContact } from "../../../server/repos/contacts";
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

import { GET as listTagsRoute, POST as attachRoute } from "./route";
import { POST as detachRoute } from "./detach/route";
import { DELETE as deleteRoute } from "./[id]/route";

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("tag route handlers", () => {
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

  it("attaches the same tag to a company and a contact and hides workspace ids", async () => {
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

    const companyTag = await attachRoute(
      jsonRequest("http://localhost/api/tags", "POST", {
        label: "Dream Company",
        entityType: "company",
        entityId: "microsoft",
      }),
    );
    const attached = (await companyTag.json()) as Record<string, unknown>;
    expect(companyTag.status).toBe(201);
    expect(attached).toMatchObject({ label: "Dream Company" });
    expect(attached).not.toHaveProperty("workspaceId");

    const contactTag = await attachRoute(
      jsonRequest("http://localhost/api/tags", "POST", {
        label: "Alumni Available",
        entityType: "contact",
        entityId: "rahul",
      }),
    );
    expect(contactTag.status).toBe(201);

    const listed = await listTagsRoute(
      jsonRequest("http://localhost/api/tags", "GET"),
    );
    expect(await listed.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Dream Company" }),
        expect.objectContaining({ label: "Alumni Available" }),
      ]),
    );

    const onCompany = await listTagsRoute(
      jsonRequest(
        "http://localhost/api/tags?entityType=company&entityId=microsoft",
        "GET",
      ),
    );
    expect(await onCompany.json()).toEqual([
      expect.objectContaining({ label: "Dream Company" }),
    ]);

    const foreign = await attachRoute(
      jsonRequest("http://localhost/api/tags", "POST", {
        label: "Dream Company",
        entityType: "company",
        entityId: "missing",
      }),
    );
    expect(foreign.status).toBe(404);
  });

  it("detaches a tag without deleting the entity", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    const created = await attachRoute(
      jsonRequest("http://localhost/api/tags", "POST", {
        label: "Dream Company",
        entityType: "company",
        entityId: "microsoft",
      }),
    );
    const attached = (await created.json()) as { tagId: string };

    const detached = await detachRoute(
      jsonRequest("http://localhost/api/tags/detach", "POST", {
        tagId: attached.tagId,
        entityType: "company",
        entityId: "microsoft",
      }),
    );
    expect(detached.status).toBe(204);

    const deleted = await deleteRoute(
      jsonRequest(`http://localhost/api/tags/${attached.tagId}`, "DELETE"),
      { params: Promise.resolve({ id: attached.tagId }) },
    );
    expect(deleted.status).toBe(204);
  });
});

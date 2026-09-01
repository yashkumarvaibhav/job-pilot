import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../../../test/tenant-fixture";
import { createCompany } from "../../../server/repos/companies";
import { createContact } from "../../../server/repos/contacts";

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

import { GET as listContactsRoute, POST } from "./route";
import { GET as getContactRoute, PUT } from "./[id]/route";

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("contact route handlers", () => {
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

  it("creates, lists, reloads and updates a contact without tenant internals", async () => {
    const fixture = newFixture();
    const microsoft = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });

    const createdResponse = await POST(
      jsonRequest("http://localhost/api/contacts", "POST", {
        companyId: microsoft.id,
        name: " Rahul Sharma ",
        relationship: "friend",
        networkingStatus: "checking_for_openings",
        tags: ["backend", "alumni"],
        preferredContactChannel: "email",
        followUpOn: "2026-09-02",
        methods: [
          { kind: "email", value: "rahul@invalid.test", isPrimary: true },
        ],
      }),
    );
    const created = (await createdResponse.json()) as Record<string, unknown>;

    expect(createdResponse.status).toBe(201);
    expect(created).toMatchObject({
      name: "Rahul Sharma",
      companyId: microsoft.id,
      companyName: "Microsoft",
      relationship: "friend",
      networkingStatus: "checking_for_openings",
      tags: ["backend", "alumni"],
      followUpOn: "2026-09-02",
      methods: [
        {
          kind: "email",
          value: "rahul@invalid.test",
          isPrimary: true,
        },
      ],
    });
    expect(JSON.stringify(created)).not.toContain("workspace");
    expect(JSON.stringify(created)).not.toContain("valueNormalized");

    const listResponse = await listContactsRoute();
    const listed = (await listResponse.json()) as Record<string, unknown>[];
    expect(listed).toEqual([
      expect.objectContaining({
        id: created.id,
        name: "Rahul Sharma",
        companyName: "Microsoft",
      }),
    ]);

    const updateResponse = await PUT(
      jsonRequest(
        `http://localhost/api/contacts/${created.id as string}`,
        "PUT",
        {
          networkingStatus: "waiting_for_reply",
          nextAction: "Follow up on WhatsApp",
        },
      ),
      { params: Promise.resolve({ id: created.id as string }) },
    );
    expect(await updateResponse.json()).toMatchObject({
      networkingStatus: "waiting_for_reply",
      nextAction: "Follow up on WhatsApp",
    });

    const reloaded = await getContactRoute(
      new Request(`http://localhost/api/contacts/${created.id as string}`),
      { params: Promise.resolve({ id: created.id as string }) },
    );
    expect(await reloaded.json()).toMatchObject({
      name: "Rahul Sharma",
      networkingStatus: "waiting_for_reply",
    });
  });

  it("rejects malformed, invalid and tenant-injected input", async () => {
    const fixture = newFixture();

    for (const body of [
      { name: "" },
      { name: "Valid", relationship: "best_friend" },
      { name: "Valid", networkingStatus: "emailed" },
      { name: "Valid", tags: "backend" },
      { name: "Valid", methods: [{ kind: "email", value: "not-an-email" }] },
      { name: "Valid", workspaceId: fixture.tenantB.workspaceId },
    ]) {
      const response = await POST(
        jsonRequest("http://localhost/api/contacts", "POST", body),
      );
      expect(response.status).toBe(400);
    }
    expect(fixture.rowCount("contact")).toBe(0);
  });

  it("returns Contact not found for a foreign id and writes no activity", async () => {
    const fixture = newFixture();
    const foreign = createContact(fixture.client.db, fixture.tenantB, {
      id: "private-contact",
      name: "Private Person",
    });
    const before = fixture.rowCount("activity_event");

    const readResponse = await getContactRoute(
      new Request(`http://localhost/api/contacts/${foreign.id}`),
      { params: Promise.resolve({ id: foreign.id }) },
    );
    expect(readResponse.status).toBe(404);
    expect(await readResponse.json()).toEqual({ error: "Contact not found" });

    const updateResponse = await PUT(
      jsonRequest(`http://localhost/api/contacts/${foreign.id}`, "PUT", {
        name: "Leaked",
      }),
      { params: Promise.resolve({ id: foreign.id }) },
    );
    expect(updateResponse.status).toBe(404);
    expect(await updateResponse.json()).toEqual({ error: "Contact not found" });
    expect(fixture.rowCount("activity_event")).toBe(before);
  });

  it("requires a validated session before reading or writing", async () => {
    newFixture();
    mocks.tenant = null;

    const listResponse = await listContactsRoute();
    const createResponse = await POST(
      jsonRequest("http://localhost/api/contacts", "POST", {
        name: "No session",
      }),
    );

    expect(listResponse.status).toBe(401);
    expect(createResponse.status).toBe(401);
  });
});

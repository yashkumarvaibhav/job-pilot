import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCompany } from "../../../server/repos/companies";
import { createContact } from "../../../server/repos/contacts";
import { createOpportunity } from "../../../server/repos/opportunities";
import { createReferral } from "../../../server/repos/referrals";
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
import { GET as detailRoute, PATCH } from "./[id]/route";

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("referral route handlers", () => {
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

  it("creates, lists, and updates without exposing workspace ids", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: company.id,
      name: "Rahul Sharma",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "ms-sde",
      companyId: company.id,
      role: "SDE",
    });

    const createdResponse = await POST(
      jsonRequest("http://localhost/api/referrals", "POST", {
        contactId: "rahul",
        opportunityId: "ms-sde",
        channel: "whatsapp",
        stage: "requested",
      }),
    );
    const created = (await createdResponse.json()) as Record<string, unknown>;

    expect(createdResponse.status).toBe(201);
    expect(created).toMatchObject({
      contactName: "Rahul Sharma",
      role: "SDE",
      companyName: "Microsoft",
      channel: "whatsapp",
      stage: "requested",
    });
    expect(created).not.toHaveProperty("workspaceId");

    const listed = await listRoute(
      new Request("http://localhost/api/referrals"),
    );
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([
      expect.objectContaining({ id: created.id, contactName: "Rahul Sharma" }),
    ]);

    const updatedResponse = await PATCH(
      jsonRequest(
        `http://localhost/api/referrals/${created.id as string}`,
        "PATCH",
        { stage: "referral_promised" },
      ),
      { params: Promise.resolve({ id: created.id as string }) },
    );
    expect(updatedResponse.status).toBe(200);
    expect(await updatedResponse.json()).toMatchObject({
      stage: "referral_promised",
    });

    const promised = await listRoute(
      new Request(
        "http://localhost/api/referrals?preset=promised_not_received",
      ),
    );
    expect(await promised.json()).toEqual([
      expect.objectContaining({ id: created.id }),
    ]);
  });

  it("hides foreign referrals as not found and does not write", async () => {
    const fixture = newFixture();
    createContact(fixture.client.db, fixture.tenantB, {
      id: "hidden",
      name: "Hidden Person",
    });
    const foreign = createReferral(fixture.client.db, fixture.tenantB, {
      id: "referral-b",
      contactId: "hidden",
      channel: "email",
      stage: "requested",
    });
    const before = fixture.rowCount("activity_event");

    expect(
      (
        await POST(
          jsonRequest("http://localhost/api/referrals", "POST", {
            contactId: "hidden",
            channel: "whatsapp",
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await detailRoute(new Request("http://localhost/api/referrals/missing"), {
        params: Promise.resolve({ id: "missing" }),
      })).status,
    ).toBe(404);
    expect(
      (
        await PATCH(
          jsonRequest(
            `http://localhost/api/referrals/${foreign!.id}`,
            "PATCH",
            { stage: "referral_promised" },
          ),
          { params: Promise.resolve({ id: foreign!.id }) },
        )
      ).status,
    ).toBe(404);
    expect(fixture.rowCount("activity_event")).toBe(before);
  });
});

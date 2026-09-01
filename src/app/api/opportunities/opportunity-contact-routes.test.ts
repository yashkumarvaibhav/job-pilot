import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCompany } from "../../../server/repos/companies";
import { createContact } from "../../../server/repos/contacts";
import { createInteraction } from "../../../server/repos/interactions";
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

import { POST as linkRoute } from "./[id]/link-contact/route";
import { POST as fromConversationRoute } from "./from-conversation/route";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("opportunity-contact route handlers", () => {
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

  it("creates from conversation and links an existing contact without exposing workspace ids", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: company.id,
      name: "Rahul Sharma",
    });
    createInteraction(fixture.client.db, fixture.tenantA, {
      contactId: contact.id,
      channel: "whatsapp",
      direction: "inbound",
      body: "There's an SDE opening. Job ID 182763.",
    });

    const createdResponse = await fromConversationRoute(
      jsonRequest("http://localhost/api/opportunities/from-conversation", {
        contactId: contact.id,
        role: "SDE",
        jobId: "182763",
      }),
    );
    const created = (await createdResponse.json()) as Record<string, unknown>;

    expect(createdResponse.status).toBe(201);
    expect(created).toMatchObject({
      role: "SDE",
      jobId: "182763",
      companyName: "Microsoft",
      source: "Conversation",
    });
    expect(created).not.toHaveProperty("workspaceId");

    const opportunity = createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-swe",
      companyId: company.id,
      role: "Software Engineer",
      jobId: "999",
    });
    const linkedResponse = await linkRoute(
      jsonRequest(
        `http://localhost/api/opportunities/${opportunity.id}/link-contact`,
        { contactId: contact.id },
      ),
      { params: Promise.resolve({ id: opportunity.id }) },
    );
    const linked = (await linkedResponse.json()) as Record<string, unknown>;

    expect(linkedResponse.status).toBe(201);
    expect(linked).toMatchObject({
      contactId: "rahul",
      contactName: "Rahul Sharma",
      opportunityId: "google-swe",
    });
    expect(linked).not.toHaveProperty("workspaceId");
  });

  it("rejects missing fields, injected workspace ids, and unlogged openings", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: company.id,
      name: "Rahul Sharma",
    });

    const missingOpening = await fromConversationRoute(
      jsonRequest("http://localhost/api/opportunities/from-conversation", {
        contactId: contact.id,
        role: "SDE",
      }),
    );
    expect(missingOpening.status).toBe(400);
    expect(await missingOpening.json()).toEqual({
      error: "Log the opening first.",
    });

    for (const body of [
      { role: "SDE" },
      { contactId: contact.id },
      {
        contactId: contact.id,
        role: "SDE",
        workspaceId: fixture.tenantB.workspaceId,
      },
    ]) {
      const response = await fromConversationRoute(
        jsonRequest("http://localhost/api/opportunities/from-conversation", body),
      );
      expect(response.status).toBe(400);
    }
    expect(fixture.rowCount("opportunity")).toBe(0);
  });

  it("returns not found for foreign ids and requires authentication", async () => {
    const fixture = newFixture();
    const foreignCompany = createCompany(fixture.client.db, fixture.tenantB, {
      id: "private-company",
      name: "Private Company",
    });
    const foreignContact = createContact(fixture.client.db, fixture.tenantB, {
      id: "private-contact",
      companyId: foreignCompany.id,
      name: "Private Person",
    });
    createInteraction(fixture.client.db, fixture.tenantB, {
      contactId: foreignContact.id,
      channel: "whatsapp",
      direction: "inbound",
      body: "Private opening.",
    });
    const foreignOpportunity = createOpportunity(
      fixture.client.db,
      fixture.tenantB,
      {
        id: "private-opportunity",
        companyId: foreignCompany.id,
        role: "Private Role",
      },
    );
    const ownedCompany = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    const ownedOpportunity = createOpportunity(
      fixture.client.db,
      fixture.tenantA,
      {
        id: "owned-opportunity",
        companyId: ownedCompany.id,
        role: "Owned Role",
      },
    );
    const before = fixture.rowCount("activity_event");

    const fromForeign = await fromConversationRoute(
      jsonRequest("http://localhost/api/opportunities/from-conversation", {
        contactId: foreignContact.id,
        role: "SDE",
      }),
    );
    expect(fromForeign.status).toBe(404);
    expect(await fromForeign.json()).toEqual({ error: "Contact not found" });

    const linkForeignOpportunity = await linkRoute(
      jsonRequest(
        `http://localhost/api/opportunities/${foreignOpportunity.id}/link-contact`,
        { contactId: foreignContact.id },
      ),
      { params: Promise.resolve({ id: foreignOpportunity.id }) },
    );
    expect(linkForeignOpportunity.status).toBe(404);
    expect(await linkForeignOpportunity.json()).toEqual({
      error: "Opportunity not found",
    });

    const linkForeignContact = await linkRoute(
      jsonRequest(
        `http://localhost/api/opportunities/${ownedOpportunity.id}/link-contact`,
        { contactId: foreignContact.id },
      ),
      { params: Promise.resolve({ id: ownedOpportunity.id }) },
    );
    expect(linkForeignContact.status).toBe(404);
    expect(await linkForeignContact.json()).toEqual({
      error: "Contact not found",
    });
    expect(fixture.rowCount("opportunity_contact")).toBe(0);
    expect(fixture.rowCount("activity_event")).toBe(before);

    mocks.tenant = null;
    expect(
      (
        await fromConversationRoute(
          jsonRequest("http://localhost/api/opportunities/from-conversation", {
            contactId: "rahul",
            role: "SDE",
          }),
        )
      ).status,
    ).toBe(401);
  });
});

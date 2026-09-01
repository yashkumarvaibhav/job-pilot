import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../../../test/tenant-fixture";
import { createCompany } from "../../../server/repos/companies";
import { createContact } from "../../../server/repos/contacts";
import { createInteraction } from "../../../server/repos/interactions";

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

import { POST as logInteraction } from "./[id]/interactions/route";
import { POST as markReplied } from "./[id]/interactions/[interactionId]/mark-replied/route";

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("contact interaction route handlers", () => {
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

  it("logs an interaction on the owned contact without tenant internals", async () => {
    const fixture = newFixture();
    const microsoft = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: microsoft.id,
      name: "Rahul Sharma",
    });

    const response = await logInteraction(
      jsonRequest(`http://localhost/api/contacts/${contact.id}/interactions`, "POST", {
        channel: "whatsapp",
        direction: "outbound",
        body: "Are there any SWE openings in your team/company?",
        occurredAt: "2026-08-30T10:32:00.000Z",
      }),
      { params: Promise.resolve({ id: contact.id }) },
    );
    const created = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(created).toMatchObject({
      contactId: "rahul",
      companyId: "microsoft",
      channel: "whatsapp",
      direction: "outbound",
      body: "Are there any SWE openings in your team/company?",
      requiresReply: false,
      occurredAt: "2026-08-30T10:32:00.000Z",
    });
    expect(JSON.stringify(created)).not.toContain("workspace");
  });

  it("marks Need Reply resolved on the owned inbound row", async () => {
    const fixture = newFixture();
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
    });
    const logged = createInteraction(fixture.client.db, fixture.tenantA, {
      id: "needs-reply",
      contactId: contact.id,
      channel: "whatsapp",
      direction: "inbound",
      body: "Let me check. Give me 2-3 days.",
      requiresReply: true,
    });

    const response = await markReplied(
      jsonRequest(
        `http://localhost/api/contacts/${contact.id}/interactions/${logged.id}/mark-replied`,
        "POST",
      ),
      {
        params: Promise.resolve({
          id: contact.id,
          interactionId: logged.id,
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      requiresReply: boolean;
      replyResolvedAt: string | null;
    };
    expect(body).toMatchObject({
      id: "needs-reply",
      requiresReply: true,
    });
    expect(body.replyResolvedAt).toEqual(expect.any(String));
  });

  it("rejects malformed input and foreign ids without writing activity", async () => {
    const fixture = newFixture();
    const own = createContact(fixture.client.db, fixture.tenantA, {
      id: "own",
      name: "Own Person",
    });
    const foreign = createContact(fixture.client.db, fixture.tenantB, {
      id: "private-contact",
      name: "Private Person",
    });
    const foreignLog = createInteraction(fixture.client.db, fixture.tenantB, {
      id: "private-log",
      contactId: foreign.id,
      channel: "email",
      direction: "inbound",
      body: "Secret",
      requiresReply: true,
    });
    const before = fixture.rowCount("activity_event");

    const malformed = await logInteraction(
      jsonRequest(`http://localhost/api/contacts/${own.id}/interactions`, "POST", {
        channel: "carrier-pigeon",
        direction: "outbound",
        body: "Nope",
      }),
      { params: Promise.resolve({ id: own.id }) },
    );
    expect(malformed.status).toBe(400);

    const injected = await logInteraction(
      jsonRequest(`http://localhost/api/contacts/${own.id}/interactions`, "POST", {
        channel: "whatsapp",
        direction: "outbound",
        body: "Nope",
        workspaceId: fixture.tenantB.workspaceId,
      }),
      { params: Promise.resolve({ id: own.id }) },
    );
    expect(injected.status).toBe(400);

    const foreignContact = await logInteraction(
      jsonRequest(
        `http://localhost/api/contacts/${foreign.id}/interactions`,
        "POST",
        {
          channel: "whatsapp",
          direction: "outbound",
          body: "Nope",
        },
      ),
      { params: Promise.resolve({ id: foreign.id }) },
    );
    expect(foreignContact.status).toBe(404);
    expect(await foreignContact.json()).toEqual({ error: "Contact not found" });

    const foreignMark = await markReplied(
      jsonRequest(
        `http://localhost/api/contacts/${foreign.id}/interactions/${foreignLog.id}/mark-replied`,
        "POST",
      ),
      {
        params: Promise.resolve({
          id: foreign.id,
          interactionId: foreignLog.id,
        }),
      },
    );
    expect(foreignMark.status).toBe(404);
    expect(fixture.rowCount("activity_event")).toBe(before);
  });

  it("requires a validated session before logging", async () => {
    newFixture();
    mocks.tenant = null;

    const response = await logInteraction(
      jsonRequest("http://localhost/api/contacts/rahul/interactions", "POST", {
        channel: "whatsapp",
        direction: "outbound",
        body: "Hi",
      }),
      { params: Promise.resolve({ id: "rahul" }) },
    );
    expect(response.status).toBe(401);
  });
});

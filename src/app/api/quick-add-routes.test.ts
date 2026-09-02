import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCompany } from "../../server/repos/companies";
import { createContact } from "../../server/repos/contacts";
import { createOpportunity } from "../../server/repos/opportunities";
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

import { POST as addApplication } from "./applications/route";
import { POST as addCompany } from "./companies/route";
import { POST as addContact } from "./contacts/route";
import { POST as logInteraction } from "./contacts/[id]/interactions/route";
import { POST as addInterview } from "./interviews/route";
import { POST as addOpportunity } from "./opportunities/route";
import { POST as addTask } from "./tasks/route";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("quick-add route boundaries", () => {
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

  it("rejects a supplied workspace id on every quick-add write", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "company-a",
      name: "Amazon",
    });
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "contact-a",
      companyId: company.id,
      name: "Priya Nair",
    });
    const opportunity = createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "opportunity-a",
      companyId: company.id,
      role: "SDE",
    });
    const workspaceId = fixture.tenantB.workspaceId;
    const before = fixture.rowCount("activity_event");

    const responses = await Promise.all([
      addCompany(jsonRequest("http://localhost/api/companies", { name: "Injected", workspaceId })),
      addContact(jsonRequest("http://localhost/api/contacts", { name: "Injected", workspaceId })),
      addOpportunity(jsonRequest("http://localhost/api/opportunities", { companyId: company.id, role: "Injected", workspaceId })),
      addApplication(jsonRequest("http://localhost/api/applications", { opportunityId: opportunity.id, portal: "Workday", appliedOn: "2026-09-01", workspaceId })),
      addInterview(jsonRequest("http://localhost/api/interviews", { opportunityId: opportunity.id, kind: "Coding", workspaceId })),
      addTask(jsonRequest("http://localhost/api/tasks", { title: "Injected", workspaceId })),
      logInteraction(
        jsonRequest(`http://localhost/api/contacts/${contact.id}/interactions`, {
          channel: "whatsapp",
          direction: "inbound",
          body: "Injected",
          workspaceId,
        }),
        { params: Promise.resolve({ id: contact.id }) },
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400, 400, 400, 400]);
    expect(fixture.rowCount("activity_event")).toBe(before);
  });

  it("treats every selected foreign entity as missing and writes no event", async () => {
    const fixture = newFixture();
    const foreignCompany = createCompany(fixture.client.db, fixture.tenantB, {
      id: "company-b",
      name: "Private Company",
    });
    const foreignContact = createContact(fixture.client.db, fixture.tenantB, {
      id: "contact-b",
      companyId: foreignCompany.id,
      name: "Private Person",
    });
    const foreignOpportunity = createOpportunity(fixture.client.db, fixture.tenantB, {
      id: "opportunity-b",
      companyId: foreignCompany.id,
      role: "Private Role",
    });
    const before = fixture.rowCount("activity_event");

    const contact = await addContact(
      jsonRequest("http://localhost/api/contacts", {
        name: "Cross tenant",
        companyId: foreignCompany.id,
      }),
    );
    const opportunity = await addOpportunity(
      jsonRequest("http://localhost/api/opportunities", {
        companyId: foreignCompany.id,
        role: "Cross tenant",
      }),
    );
    const application = await addApplication(
      jsonRequest("http://localhost/api/applications", {
        opportunityId: foreignOpportunity.id,
        portal: "Workday",
        appliedOn: "2026-09-01",
      }),
    );
    const interaction = await logInteraction(
      jsonRequest(`http://localhost/api/contacts/${foreignContact.id}/interactions`, {
        channel: "whatsapp",
        direction: "inbound",
        body: "Cross tenant",
      }),
      { params: Promise.resolve({ id: foreignContact.id }) },
    );
    const interview = await addInterview(
      jsonRequest("http://localhost/api/interviews", {
        opportunityId: foreignOpportunity.id,
        kind: "Coding",
      }),
    );
    const task = await addTask(
      jsonRequest("http://localhost/api/tasks", {
        title: "Cross tenant",
        entityType: "contact",
        entityId: foreignContact.id,
      }),
    );

    expect([contact.status, opportunity.status, application.status, interaction.status, interview.status, task.status]).toEqual([400, 400, 404, 404, 404, 400]);
    expect(fixture.rowCount("activity_event")).toBe(before);
  });
});

import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createCompany } from "./companies";
import { createContact } from "./contacts";
import { createInteraction } from "./interactions";
import {
  OpportunityInputError,
  createOpportunity,
  createOpportunityFromConversation,
  getOpportunity,
  linkContactToOpportunity,
  listContactOpportunities,
  listOpportunityContacts,
} from "./opportunities";

describe("opportunity-contact links", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  function seedOwnedOpening(fixture: ReturnType<typeof newFixture>) {
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: company.id,
      name: "Rahul Sharma",
    });
    const interaction = createInteraction(fixture.client.db, fixture.tenantA, {
      id: "whatsapp-in",
      contactId: contact.id,
      channel: "whatsapp",
      direction: "inbound",
      body: "There's an SDE opening. Job ID 182763.",
      occurredAt: new Date("2026-09-01T10:00:00.000Z"),
    });
    return { company, contact, interaction };
  }

  it("links a contact without cloning it and keeps interactions on the contact", () => {
    const fixture = newFixture();
    const { contact } = seedOwnedOpening(fixture);
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "google",
      name: "Google",
    });
    const opportunity = createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-swe",
      companyId: company.id,
      role: "Software Engineer",
    });
    const contactsBefore = fixture.rowCount("contact");
    const interactionsBefore = fixture.rowCount("interaction");

    const linked = linkContactToOpportunity(
      fixture.client.db,
      fixture.tenantA,
      opportunity.id,
      contact.id,
      new Date("2026-09-01T12:00:00.000Z"),
    );

    expect(linked).toMatchObject({
      opportunityId: opportunity.id,
      contactId: contact.id,
      contactName: "Rahul Sharma",
    });
    expect(fixture.rowCount("contact")).toBe(contactsBefore);
    expect(fixture.rowCount("interaction")).toBe(interactionsBefore);
    expect(fixture.rowCount("opportunity_contact")).toBe(1);
    expect(listOpportunityContacts(fixture.client.db, fixture.tenantA, opportunity.id)).toEqual(
      [expect.objectContaining({ contactId: "rahul", contactName: "Rahul Sharma" })],
    );
    expect(listContactOpportunities(fixture.client.db, fixture.tenantA, contact.id)).toEqual(
      [expect.objectContaining({ id: "google-swe", role: "Software Engineer" })],
    );
    expect(
      fixture.client.sqlite
        .prepare(
          "select id, contact_id, opportunity_id, body from interaction where workspace_id = ? order by id",
        )
        .all(fixture.tenantA.workspaceId),
    ).toEqual([
      {
        id: "whatsapp-in",
        contact_id: "rahul",
        opportunity_id: null,
        body: "There's an SDE opening. Job ID 182763.",
      },
    ]);
    expect(
      fixture.client.sqlite
        .prepare(
          "select kind, entity_type, entity_id from activity_event where workspace_id = ? and kind = 'OPPORTUNITY_CONTACT_LINKED'",
        )
        .all(fixture.tenantA.workspaceId),
    ).toEqual([
      {
        kind: "OPPORTUNITY_CONTACT_LINKED",
        entity_type: "opportunity",
        entity_id: "google-swe",
      },
    ]);
  });

  it("does not insert a second link row when the same pair is linked again", () => {
    const fixture = newFixture();
    const { contact } = seedOwnedOpening(fixture);
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "google",
      name: "Google",
    });
    const opportunity = createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-swe",
      companyId: company.id,
      role: "Software Engineer",
    });
    linkContactToOpportunity(
      fixture.client.db,
      fixture.tenantA,
      opportunity.id,
      contact.id,
    );
    const eventsBefore = fixture.rowCount("activity_event");

    const again = linkContactToOpportunity(
      fixture.client.db,
      fixture.tenantA,
      opportunity.id,
      contact.id,
    );

    expect(again).toMatchObject({ contactId: "rahul", opportunityId: "google-swe" });
    expect(fixture.rowCount("opportunity_contact")).toBe(1);
    expect(fixture.rowCount("activity_event")).toBe(eventsBefore);
  });

  it("rejects a cross-workspace link without writing an event, and SQLite rejects the mismatched pair", () => {
    const fixture = newFixture();
    const owned = seedOwnedOpening(fixture);
    const foreignCompany = createCompany(fixture.client.db, fixture.tenantB, {
      id: "private-company",
      name: "Private Company",
    });
    const foreignContact = createContact(fixture.client.db, fixture.tenantB, {
      id: "private-contact",
      companyId: foreignCompany.id,
      name: "Private Person",
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
    const opportunity = createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "owned-opportunity",
      companyId: owned.company.id,
      role: "Owned Role",
    });
    const beforeEvents = fixture.rowCount("activity_event");

    expect(
      linkContactToOpportunity(
        fixture.client.db,
        fixture.tenantA,
        foreignOpportunity.id,
        owned.contact.id,
      ),
    ).toBeUndefined();
    expect(
      linkContactToOpportunity(
        fixture.client.db,
        fixture.tenantA,
        opportunity.id,
        foreignContact.id,
      ),
    ).toBeUndefined();
    expect(fixture.rowCount("opportunity_contact")).toBe(0);
    expect(fixture.rowCount("activity_event")).toBe(beforeEvents);
    expect(
      listOpportunityContacts(
        fixture.client.db,
        fixture.tenantA,
        foreignOpportunity.id,
      ),
    ).toEqual([]);
    expect(
      listContactOpportunities(
        fixture.client.db,
        fixture.tenantA,
        foreignContact.id,
      ),
    ).toEqual([]);

    expect(() =>
      fixture.client.sqlite
        .prepare(
          `insert into opportunity_contact
            (id, workspace_id, opportunity_id, contact_id, created_at)
           values ('cross', ?, ?, ?, ?)`,
        )
        .run(
          fixture.tenantA.workspaceId,
          opportunity.id,
          foreignContact.id,
          Date.now(),
        ),
    ).toThrowError(/FOREIGN KEY/i);
  });

  it("creates from conversation by linking the existing contact and company, not cloning history", () => {
    const fixture = newFixture();
    const { contact, interaction } = seedOwnedOpening(fixture);
    const contactsBefore = fixture.rowCount("contact");
    const created = createOpportunityFromConversation(
      fixture.client.db,
      fixture.tenantA,
      {
        id: "microsoft-sde",
        contactId: contact.id,
        role: "SDE",
        jobId: "182763",
        now: new Date("2026-09-01T12:30:00.000Z"),
      },
    );

    expect(created).toMatchObject({
      id: "microsoft-sde",
      companyId: "microsoft",
      companyName: "Microsoft",
      role: "SDE",
      jobId: "182763",
      source: "Conversation",
    });
    expect(fixture.rowCount("contact")).toBe(contactsBefore);
    expect(listOpportunityContacts(fixture.client.db, fixture.tenantA, created.id)).toEqual(
      [expect.objectContaining({ contactId: "rahul", contactName: "Rahul Sharma" })],
    );
    expect(
      fixture.client.sqlite
        .prepare(
          "select id, contact_id, opportunity_id from interaction where id = ?",
        )
        .get(interaction.id),
    ).toEqual({
      id: "whatsapp-in",
      contact_id: "rahul",
      opportunity_id: null,
    });
    expect(
      fixture.client.sqlite
        .prepare(
          "select kind from activity_event where workspace_id = ? and entity_id = ? order by kind",
        )
        .all(fixture.tenantA.workspaceId, created.id),
    ).toEqual([
      { kind: "OPPORTUNITY_CONTACT_LINKED" },
      { kind: "OPPORTUNITY_CREATED" },
    ]);
  });

  it("uses the company picker when the contact has none, and requires a role and a logged opening", () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
    });
    const before = fixture.rowCount("activity_event");

    expect(() =>
      createOpportunityFromConversation(fixture.client.db, fixture.tenantA, {
        contactId: contact.id,
        role: "SDE",
        companyId: company.id,
      }),
    ).toThrowError(/Log the opening first/);
    expect(fixture.rowCount("opportunity")).toBe(0);
    expect(fixture.rowCount("activity_event")).toBe(before);

    createInteraction(fixture.client.db, fixture.tenantA, {
      contactId: contact.id,
      channel: "whatsapp",
      direction: "inbound",
      body: "Opening on our team.",
    });

    expect(() =>
      createOpportunityFromConversation(fixture.client.db, fixture.tenantA, {
        contactId: contact.id,
        role: "SDE",
      }),
    ).toThrowError(OpportunityInputError);

    const created = createOpportunityFromConversation(
      fixture.client.db,
      fixture.tenantA,
      {
        contactId: contact.id,
        companyId: company.id,
        role: "SDE",
      },
    );
    expect(created).toMatchObject({ companyId: "microsoft", role: "SDE" });
  });

  it("treats a foreign contact as missing for from-conversation and writes no event", () => {
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
    const before = fixture.rowCount("activity_event");

    expect(
      createOpportunityFromConversation(fixture.client.db, fixture.tenantA, {
        contactId: foreignContact.id,
        role: "SDE",
        companyId: foreignCompany.id,
      }),
    ).toBeUndefined();
    expect(getOpportunity(fixture.client.db, fixture.tenantA, "anything")).toBe(
      undefined,
    );
    expect(fixture.rowCount("opportunity")).toBe(0);
    expect(fixture.rowCount("opportunity_contact")).toBe(0);
    expect(fixture.rowCount("activity_event")).toBe(before);
  });
});

import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createCompany } from "./companies";
import { createContact } from "./contacts";
import { createOpportunity } from "./opportunities";
import {
  InteractionInputError,
  countUnresolvedNeedReply,
  createInteraction,
  getInteraction,
  listInteractions,
  markInteractionReplied,
} from "./interactions";

describe("interaction repository", () => {
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

  it("logs a contact-only interaction and records the matching activity event", () => {
    const fixture = newFixture();
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
    });

    const created = createInteraction(fixture.client.db, fixture.tenantA, {
      id: "whatsapp-out",
      contactId: contact.id,
      channel: "whatsapp",
      direction: "outbound",
      body: "Are there any SWE openings in your team/company?",
      occurredAt: new Date("2026-08-30T10:32:00.000Z"),
      now: new Date("2026-08-30T10:32:00.000Z"),
    });

    expect(created).toMatchObject({
      id: "whatsapp-out",
      contactId: "rahul",
      companyId: null,
      opportunityId: null,
      referralId: null,
      channel: "whatsapp",
      direction: "outbound",
      body: "Are there any SWE openings in your team/company?",
      requiresReply: false,
      replyResolvedAt: null,
    });
    expect(
      getInteraction(fixture.client.db, fixture.tenantA, "whatsapp-out"),
    ).toEqual(created);
    expect(
      fixture.client.sqlite
        .prepare(
          "select kind, entity_type, entity_id from activity_event where workspace_id = ? and kind like 'INTERACTION_%' order by at",
        )
        .all(fixture.tenantA.workspaceId),
    ).toEqual([
      {
        kind: "INTERACTION_SENT",
        entity_type: "interaction",
        entity_id: "whatsapp-out",
      },
    ]);
  });

  it("rejects an interaction with none of the four context keys", () => {
    const fixture = newFixture();
    const before = fixture.rowCount("activity_event");

    expect(() =>
      createInteraction(fixture.client.db, fixture.tenantA, {
        channel: "email",
        direction: "outbound",
        body: "No context",
      }),
    ).toThrowError(InteractionInputError);
    expect(fixture.rowCount("interaction")).toBe(0);
    expect(fixture.rowCount("activity_event")).toBe(before);
  });

  it("scopes an opportunity timeline to rows linked to that opportunity", () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "company-a",
      name: "Company A",
    });
    const opportunity = createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "sde-182763",
      companyId: company.id,
      role: "SDE I",
    });
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
    });

    createInteraction(fixture.client.db, fixture.tenantA, {
      id: "general",
      contactId: contact.id,
      channel: "whatsapp",
      direction: "outbound",
      body: "Any openings?",
      occurredAt: new Date("2026-08-30T10:00:00.000Z"),
    });
    createInteraction(fixture.client.db, fixture.tenantA, {
      id: "job-specific",
      contactId: contact.id,
      opportunityId: opportunity.id,
      channel: "email",
      direction: "outbound",
      body: "Referral request - SDE I",
      occurredAt: new Date("2026-08-30T10:32:00.000Z"),
    });

    expect(
      listInteractions(fixture.client.db, fixture.tenantA, {
        contactId: contact.id,
      }).map((row) => row.id),
    ).toEqual(["job-specific", "general"]);
    expect(
      listInteractions(fixture.client.db, fixture.tenantA, {
        opportunityId: "sde-182763",
      }).map((row) => row.id),
    ).toEqual(["job-specific"]);
    expect(
      listInteractions(fixture.client.db, fixture.tenantA, {
        opportunityId: "other-job",
      }),
    ).toEqual([]);
  });

  it("counts Need Reply only for unresolved inbound rows marked by the owner", () => {
    const fixture = newFixture();
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      networkingStatus: "waiting_for_reply",
    });

    createInteraction(fixture.client.db, fixture.tenantA, {
      id: "needs-reply",
      contactId: contact.id,
      channel: "whatsapp",
      direction: "inbound",
      body: "Let me check. Give me 2-3 days.",
      requiresReply: true,
      occurredAt: new Date("2026-08-30T11:00:00.000Z"),
    });
    createInteraction(fixture.client.db, fixture.tenantA, {
      id: "plain-inbound",
      contactId: contact.id,
      channel: "linkedin_dm",
      direction: "inbound",
      body: "Thanks for reaching out.",
      occurredAt: new Date("2026-08-30T11:05:00.000Z"),
    });

    expect(countUnresolvedNeedReply(fixture.client.db, fixture.tenantA)).toBe(
      1,
    );
    expect(
      createContact(fixture.client.db, fixture.tenantA, {
        id: "other",
        name: "Waiting Person",
        networkingStatus: "waiting_for_reply",
      }).networkingStatus,
    ).toBe("waiting_for_reply");
    expect(countUnresolvedNeedReply(fixture.client.db, fixture.tenantA)).toBe(
      1,
    );
  });

  it("resolves Need Reply on a later outbound without changing networking status", () => {
    const fixture = newFixture();
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      networkingStatus: "checking_for_openings",
    });
    createInteraction(fixture.client.db, fixture.tenantA, {
      id: "needs-reply",
      contactId: contact.id,
      channel: "whatsapp",
      direction: "inbound",
      body: "Let me check.",
      requiresReply: true,
      occurredAt: new Date("2026-08-30T11:00:00.000Z"),
    });

    createInteraction(fixture.client.db, fixture.tenantA, {
      id: "follow-up",
      contactId: contact.id,
      channel: "whatsapp",
      direction: "outbound",
      body: "Checking in.",
      occurredAt: new Date("2026-09-02T09:00:00.000Z"),
      now: new Date("2026-09-02T09:00:00.000Z"),
    });

    const resolved = getInteraction(
      fixture.client.db,
      fixture.tenantA,
      "needs-reply",
    );
    expect(resolved?.replyResolvedAt?.toISOString()).toBe(
      "2026-09-02T09:00:00.000Z",
    );
    expect(countUnresolvedNeedReply(fixture.client.db, fixture.tenantA)).toBe(
      0,
    );
    expect(
      fixture.client.sqlite
        .prepare("select networking_status from contact where id = ?")
        .get("rahul"),
    ).toEqual({ networking_status: "checking_for_openings" });
  });

  it("marks an inbound interaction replied without changing contact status", () => {
    const fixture = newFixture();
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      networkingStatus: "waiting_for_reply",
    });
    createInteraction(fixture.client.db, fixture.tenantA, {
      id: "needs-reply",
      contactId: contact.id,
      channel: "email",
      direction: "inbound",
      body: "Send me your resume.",
      requiresReply: true,
    });

    const marked = markInteractionReplied(
      fixture.client.db,
      fixture.tenantA,
      "needs-reply",
      new Date("2026-09-02T09:34:00.000Z"),
    );

    expect(marked?.replyResolvedAt?.toISOString()).toBe(
      "2026-09-02T09:34:00.000Z",
    );
    expect(countUnresolvedNeedReply(fixture.client.db, fixture.tenantA)).toBe(
      0,
    );
    expect(
      fixture.client.sqlite
        .prepare("select networking_status from contact where id = ?")
        .get("rahul"),
    ).toEqual({ networking_status: "waiting_for_reply" });
    expect(
      fixture.client.sqlite
        .prepare(
          "select kind from activity_event where entity_id = ? and kind = 'INTERACTION_LOGGED'",
        )
        .get("needs-reply"),
    ).toEqual({ kind: "INTERACTION_LOGGED" });
  });

  it("fails a cross-workspace context id and writes neither row nor activity", () => {
    const fixture = newFixture();
    const privateCompany = createCompany(fixture.client.db, fixture.tenantB, {
      id: "private-company",
      name: "Private Company",
    });
    const privateContact = createContact(fixture.client.db, fixture.tenantB, {
      id: "private-contact",
      companyId: privateCompany.id,
      name: "Private Person",
    });
    const privateOpportunity = createOpportunity(
      fixture.client.db,
      fixture.tenantB,
      {
        id: "private-job",
        companyId: privateCompany.id,
        role: "Private Role",
      },
    );
    const ownContact = createContact(fixture.client.db, fixture.tenantA, {
      id: "own-contact",
      name: "Own Person",
    });
    const before = fixture.rowCount("activity_event");

    expect(() =>
      createInteraction(fixture.client.db, fixture.tenantA, {
        contactId: privateContact.id,
        channel: "whatsapp",
        direction: "outbound",
        body: "Must not land",
      }),
    ).toThrowError(InteractionInputError);
    expect(() =>
      createInteraction(fixture.client.db, fixture.tenantA, {
        contactId: ownContact.id,
        opportunityId: privateOpportunity.id,
        channel: "email",
        direction: "outbound",
        body: "Must not land",
      }),
    ).toThrowError(InteractionInputError);
    expect(() =>
      createInteraction(fixture.client.db, fixture.tenantA, {
        contactId: ownContact.id,
        companyId: privateCompany.id,
        channel: "email",
        direction: "outbound",
        body: "Must not land",
      }),
    ).toThrowError(InteractionInputError);
    expect(
      getInteraction(fixture.client.db, fixture.tenantA, "missing"),
    ).toBeUndefined();
    expect(
      markInteractionReplied(
        fixture.client.db,
        fixture.tenantA,
        "missing",
      ),
    ).toBeUndefined();

    const privateRow = createInteraction(
      fixture.client.db,
      fixture.tenantB,
      {
        id: "private-log",
        contactId: privateContact.id,
        opportunityId: privateOpportunity.id,
        referralId: "private-referral",
        channel: "email",
        direction: "inbound",
        body: "Secret",
        requiresReply: true,
      },
    );
    expect(
      getInteraction(fixture.client.db, fixture.tenantA, privateRow.id),
    ).toBeUndefined();
    expect(
      listInteractions(fixture.client.db, fixture.tenantA, {
        opportunityId: "private-job",
      }),
    ).toEqual([]);
    expect(
      listInteractions(fixture.client.db, fixture.tenantA, {
        referralId: "private-referral",
      }),
    ).toEqual([]);
    expect(countUnresolvedNeedReply(fixture.client.db, fixture.tenantA)).toBe(
      0,
    );
    expect(
      markInteractionReplied(
        fixture.client.db,
        fixture.tenantA,
        privateRow.id,
      ),
    ).toBeUndefined();
    expect(fixture.rowCount("interaction")).toBe(1);
    expect(fixture.rowCount("activity_event")).toBe(before + 1);
  });

  it("copies the contact company when one is not supplied", () => {
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

    const created = createInteraction(fixture.client.db, fixture.tenantA, {
      contactId: contact.id,
      channel: "whatsapp",
      direction: "outbound",
      body: "Any openings?",
    });

    expect(created.companyId).toBe("microsoft");
    expect(
      fixture.client.sqlite
        .prepare("select last_interaction_at from contact where id = ?")
        .get("rahul"),
    ).toEqual({ last_interaction_at: created.occurredAt.valueOf() });
  });
});

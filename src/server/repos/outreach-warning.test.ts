import { afterEach, describe, expect, it } from "vitest";

import { FIND_ANOTHER_CONTACT_TITLE } from "../../domain/bounce";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { applyBouncesFromSnapshot } from "./bounce";
import { createCompany } from "./companies";
import { createContact } from "./contacts";
import { connectEmailAccount } from "./email-accounts";
import { createInteraction } from "./interactions";
import { createOpportunity } from "./opportunities";
import { evaluateComposeOutreach } from "./outreach-warning";
import { addSuppressionEntry } from "./send-safety";
import type { GmailThreadSnapshot } from "../mail/gmail-read-port";

const TOKEN_KEY = Buffer.alloc(32, 36).toString("base64");
const NOW = new Date("2026-09-04T10:00:00.000Z");
const SIXTEEN_DAYS_AGO = new Date("2026-08-19T10:00:00.000Z");

function hardBounceSnapshot(): GmailThreadSnapshot {
  return {
    gmailThreadId: "thread-bounce-rahul",
    historyId: "h",
    messages: [
      {
        gmailId: "bounce-rahul",
        rfcMessageId: "<bounce-rahul@invalid.test>",
        fromEmail: "mailer-daemon@googlemail.com",
        to: ["sender-a@invalid.test"],
        subject: "Delivery Status Notification (Failure)",
        body: "Address not found\n550 mailbox unavailable",
        deliveryStatusText:
          "Final-Recipient: rfc822; rahul@invalid.test\nAction: failed\nStatus: 5.1.1\n",
        failedRecipients: ["rahul@invalid.test"],
        sentAt: NOW,
      },
    ],
  };
}

describe("compose outreach warnings", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function setup() {
    const fixture = createTenantTestFixture();
    cleanups.push(fixture.dispose);
    const account = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-a",
        email: "sender-a@invalid.test",
        refreshToken: "refresh-a",
        now: NOW,
      },
      TOKEN_KEY,
    );
    const companyRow = createCompany(fixture.client.db, fixture.tenantA, {
      id: "company-amazon",
      name: "Amazon",
      now: NOW,
    });
    const opportunity = createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "opp-sde",
      companyId: companyRow.id,
      role: "SDE II",
      now: NOW,
    });
    const rahul = createContact(fixture.client.db, fixture.tenantA, {
      id: "contact-rahul",
      name: "Rahul Sharma",
      companyId: companyRow.id,
      methods: [{ kind: "email", value: "rahul@invalid.test", isPrimary: true }],
      now: NOW,
    });
    return { fixture, account, companyRow, opportunity, rahul };
  }

  it("quotes last channel and last response for a cooldown warning", () => {
    const { fixture, rahul, opportunity } = setup();
    createInteraction(fixture.client.db, fixture.tenantA, {
      contactId: rahul.id,
      opportunityId: opportunity.id,
      channel: "email",
      direction: "outbound",
      body: "Hi Rahul, checking for openings.",
      occurredAt: SIXTEEN_DAYS_AGO,
      now: SIXTEEN_DAYS_AGO,
    });
    createInteraction(fixture.client.db, fixture.tenantA, {
      contactId: rahul.id,
      opportunityId: opportunity.id,
      channel: "email",
      direction: "inbound",
      body: "No openings on my team currently.",
      occurredAt: new Date("2026-08-20T10:00:00.000Z"),
      now: new Date("2026-08-20T10:00:00.000Z"),
    });

    const decision = evaluateComposeOutreach(fixture.client.db, fixture.tenantA, {
      contactId: rahul.id,
      opportunityId: opportunity.id,
      now: NOW,
    });
    expect(decision.kind).toBe("warning");
    if (decision.kind !== "warning") return;
    expect(decision.copy).toContain("You contacted Rahul Sharma 16 days ago.");
    expect(decision.copy).toContain("Company: Amazon");
    expect(decision.copy).toContain("Role: SDE II");
    expect(decision.copy).toContain("Last channel: Email");
    expect(decision.copy).toContain('"No openings on my team currently."');
    expect(decision.copy).toContain("Continue?");
    expect(decision.warnings[0]?.lastChannel).toBe("email");
  });

  it("warns on the seventh person at the same company for the same opportunity", () => {
    const { fixture, companyRow, opportunity } = setup();
    for (let index = 1; index <= 6; index += 1) {
      const person = createContact(fixture.client.db, fixture.tenantA, {
        id: `contact-outreach-${index}`,
        name: `Person ${index}`,
        companyId: companyRow.id,
        methods: [
          {
            kind: "email",
            value: `person${index}@invalid.test`,
            isPrimary: true,
          },
        ],
        now: NOW,
      });
      createInteraction(fixture.client.db, fixture.tenantA, {
        contactId: person.id,
        opportunityId: opportunity.id,
        channel: "email",
        direction: "outbound",
        body: "Hello",
        occurredAt: NOW,
        now: NOW,
      });
    }
    const seventh = createContact(fixture.client.db, fixture.tenantA, {
      id: "contact-seventh",
      name: "Seventh",
      companyId: companyRow.id,
      methods: [{ kind: "email", value: "seventh@invalid.test", isPrimary: true }],
      now: NOW,
    });
    const decision = evaluateComposeOutreach(fixture.client.db, fixture.tenantA, {
      contactId: seventh.id,
      opportunityId: opportunity.id,
      now: NOW,
    });
    expect(decision).toMatchObject({
      kind: "warning",
      copy: "You have already contacted 6 people at this company for this opportunity.",
    });
  });

  it("does not offer an outreach override when the address is bounce-suppressed", () => {
    const { fixture, account, rahul } = setup();
    applyBouncesFromSnapshot(
      fixture.client.db,
      fixture.tenantA,
      account.id,
      hardBounceSnapshot(),
      NOW,
    );
    createInteraction(fixture.client.db, fixture.tenantA, {
      contactId: rahul.id,
      channel: "email",
      direction: "outbound",
      body: "Earlier email",
      occurredAt: SIXTEEN_DAYS_AGO,
      now: SIXTEEN_DAYS_AGO,
    });
    const decision = evaluateComposeOutreach(fixture.client.db, fixture.tenantA, {
      contactId: rahul.id,
      now: NOW,
    });
    expect(decision).toEqual({
      kind: "blocked",
      message: "Email is blocked by bounced suppression.",
    });
    expect(JSON.stringify(decision)).not.toContain("Continue?");
    expect(JSON.stringify(decision)).not.toContain(FIND_ANOTHER_CONTACT_TITLE);
  });

  it("does not warn for a suppression-only address with no cooldown history", () => {
    const { fixture, rahul } = setup();
    addSuppressionEntry(fixture.client.db, fixture.tenantA, {
      email: "rahul@invalid.test",
      reason: "bounced",
      sourceKey: "bounce:rahul@invalid.test",
      now: NOW,
    });
    expect(
      evaluateComposeOutreach(fixture.client.db, fixture.tenantA, {
        contactId: rahul.id,
        now: NOW,
      }),
    ).toEqual({
      kind: "blocked",
      message: "Email is blocked by bounced suppression.",
    });
  });
});

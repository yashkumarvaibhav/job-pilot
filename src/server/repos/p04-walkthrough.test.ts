import { afterEach, describe, expect, it } from "vitest";

import { parseExportQuery } from "../../domain/export";
import { renderEmailTemplate } from "../../domain/mail-template";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import type {
  GmailReadPort,
  GmailThreadSnapshot,
} from "../mail/gmail-read-port";
import type { MailPort, MailSendRequest } from "../mail/mail-port";
import { sendComposedEmail } from "../mail/compose-service";
import { createCompany } from "./companies";
import { createContact } from "./contacts";
import {
  connectEmailAccount,
  listEmailAccounts,
  setDefaultEmailAccount,
} from "./email-accounts";
import { buildWorkspaceExport } from "./export";
import {
  classifyInboxReply,
  importGmailThread,
  ingestSyncedThreadSnapshot,
  listInboxThreads,
  relinkInboxThread,
  searchGmailThreads,
} from "./inbox-content";
import {
  countUnresolvedNeedReply,
  listInteractions,
} from "./interactions";

const NOW = new Date("2026-09-03T18:00:00.000Z");
const TOKEN_KEY = Buffer.alloc(32, 22).toString("base64");

function snapshot(
  gmailThreadId: string,
  fromEmail: string,
  to: string,
  subject: string,
  body: string,
): GmailThreadSnapshot {
  return {
    gmailThreadId,
    historyId: `history-${gmailThreadId}`,
    messages: [
      {
        gmailId: `message-${gmailThreadId}`,
        rfcMessageId: `<${gmailThreadId}@invalid.test>`,
        fromEmail,
        to: [to],
        subject,
        body,
        sentAt: NOW,
      },
    ],
  };
}

describe("P04 Gmail walkthrough", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("carries one selected identity through send, import, classify and isolated export", async () => {
    const fixture = createTenantTestFixture();
    cleanups.push(fixture.dispose);

    const personal = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "synthetic-personal-subject",
        email: "personal@invalid.test",
        refreshToken: "synthetic-personal-refresh",
        senderName: "Personal sender",
        now: NOW,
      },
      TOKEN_KEY,
    );
    const career = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "synthetic-career-subject",
        email: "career@invalid.test",
        refreshToken: "synthetic-career-refresh",
        senderName: "Career sender",
        now: NOW,
      },
      TOKEN_KEY,
    );
    connectEmailAccount(
      fixture.client.db,
      fixture.tenantB,
      {
        googleSub: "synthetic-foreign-subject",
        email: "foreign@invalid.test",
        refreshToken: "synthetic-foreign-refresh",
        now: NOW,
      },
      TOKEN_KEY,
    );
    expect(
      setDefaultEmailAccount(
        fixture.client.db,
        fixture.tenantA,
        personal.id,
        NOW,
      ),
    ).toBe(true);
    expect(
      listEmailAccounts(fixture.client.db, fixture.tenantA).map((account) => ({
        email: account.email,
        isDefault: account.isDefault,
      })),
    ).toEqual([
      { email: "career@invalid.test", isDefault: false },
      { email: "personal@invalid.test", isDefault: true },
    ]);

    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "walkthrough-contact",
      name: "Riya Test",
      methods: [
        { kind: "email", value: "riya@invalid.test", isPrimary: true },
      ],
      now: NOW,
    });
    const rendered = renderEmailTemplate(
      {
        subject: "Checking in with {{first_name}}",
        body: "Hello {{first_name}}, this is {{my_name}}.",
      },
      { first_name: "Riya", my_name: "Yash" },
    );
    expect(rendered.warnings).toEqual([]);

    const sendCalls: MailSendRequest[] = [];
    const mailPort: MailPort = {
      send: async (request) => {
        sendCalls.push(request);
        return {
          gmailMessageId: "sent-message",
          gmailThreadId: "sent-thread",
          rfcMessageId: "<sent-thread@invalid.test>",
          sentAt: NOW,
        };
      },
    };
    const sent = await sendComposedEmail(
      fixture.client.db,
      fixture.tenantA,
      {
        accountId: career.id,
        contactId: contact.id,
        subject: rendered.subject,
        body: rendered.body,
        attachmentVersionIds: [],
        approval: "send_now",
      },
      { mailPort, tokenKey: TOKEN_KEY },
    );
    expect(sendCalls).toEqual([
      expect.objectContaining({
        accountId: career.id,
        refreshToken: "synthetic-career-refresh",
        fromEmail: "career@invalid.test",
        to: ["riya@invalid.test"],
        subject: "Checking in with Riya",
      }),
    ]);
    expect(listInboxThreads(fixture.client.db, fixture.tenantA, career.id)).toEqual([
      expect.objectContaining({ id: sent.threadId, accountId: career.id }),
    ]);
    expect(listInteractions(fixture.client.db, fixture.tenantA)).toEqual([
      expect.objectContaining({
        contactId: contact.id,
        direction: "outbound",
        emailMessageId: sent.messageId,
      }),
    ]);

    const importedSnapshot = snapshot(
      "imported-thread",
      "unknown@outside.invalid.test",
      career.email,
      "Interview availability",
      "Could you share two time slots?",
    );
    const readCalls: string[] = [];
    const readPort: GmailReadPort = {
      getProfileHistoryId: async () => "history-profile",
      listHistory: async () => ({
        historyId: "history-profile",
        threadIds: [],
        nextPageToken: null,
      }),
      listThreads: async ({ refreshToken, query }) => {
        readCalls.push(`${refreshToken}:${query}`);
        return { threadIds: [importedSnapshot.gmailThreadId], nextPageToken: null };
      },
      getThread: async ({ refreshToken, gmailThreadId }) => {
        readCalls.push(`${refreshToken}:${gmailThreadId}`);
        return importedSnapshot;
      },
    };
    const previews = await searchGmailThreads(
      fixture.client.db,
      fixture.tenantA,
      { accountId: career.id, query: "subject:interview" },
      { port: readPort, tokenKey: TOKEN_KEY },
    );
    expect(previews).toEqual([
      expect.objectContaining({
        gmailThreadId: "imported-thread",
        counterpartEmail: "unknown@outside.invalid.test",
      }),
    ]);
    const imported = await importGmailThread(
      fixture.client.db,
      fixture.tenantA,
      { accountId: career.id, gmailThreadId: "imported-thread" },
      { port: readPort, tokenKey: TOKEN_KEY, now: () => NOW },
    );
    expect(imported).toMatchObject({
      accountId: career.id,
      matchStatus: "unmatched",
      contactId: null,
    });
    const linked = relinkInboxThread(
      fixture.client.db,
      fixture.tenantA,
      imported.id,
      { contactId: contact.id, now: NOW },
    );
    expect(linked).toMatchObject({
      contactId: contact.id,
      matchStatus: "manual",
    });
    expect(
      classifyInboxReply(
        fixture.client.db,
        fixture.tenantA,
        imported.id,
        "need_to_respond",
        NOW,
      ),
    ).toMatchObject({ classification: "need_to_respond" });
    expect(countUnresolvedNeedReply(fixture.client.db, fixture.tenantA)).toBe(1);
    expect(readCalls).toEqual([
      "synthetic-career-refresh:subject:interview",
      "synthetic-career-refresh:imported-thread",
      "synthetic-career-refresh:imported-thread",
    ]);

    const exactContact = createContact(fixture.client.db, fixture.tenantA, {
      id: "exact-contact",
      name: "Exact Test",
      methods: [{ kind: "email", value: "exact@invalid.test" }],
      now: NOW,
    });
    expect(
      ingestSyncedThreadSnapshot(
        fixture.client.db,
        fixture.tenantA,
        personal.id,
        snapshot(
          "exact-thread",
          "exact@invalid.test",
          personal.email,
          "Referral reply",
          "Happy to help.",
        ),
        NOW,
      ),
    ).toMatchObject({
      contactId: exactContact.id,
      matchStatus: "automatic",
      matchReason: "Unique exact contact email",
    });

    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "domain-company",
      name: "Example Corp",
      website: "https://example.org",
      now: NOW,
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "domain-contact",
      companyId: company.id,
      name: "Domain Test",
      methods: [{ kind: "email", value: "known@elsewhere.invalid.test" }],
      now: NOW,
    });
    const suggested = ingestSyncedThreadSnapshot(
      fixture.client.db,
      fixture.tenantA,
      personal.id,
      snapshot(
        "suggested-thread",
        "recruiter@example.org",
        personal.email,
        "Open role",
        "Would you like to talk?",
      ),
      NOW,
    );
    expect(suggested).toMatchObject({
      contactId: null,
      matchStatus: "suggested",
      matchReason: "Company domain only",
      suggestedContactIdsJson: ["domain-contact"],
    });

    const ownerExport = buildWorkspaceExport(
      fixture.client.db,
      fixture.tenantA,
      parseExportQuery(new URLSearchParams("format=json&set=all")),
      NOW,
    ).body;
    expect(ownerExport).toContain("career@invalid.test");
    expect(ownerExport).toContain("personal@invalid.test");
    expect(ownerExport).toContain("imported-thread");
    expect(ownerExport).toContain("suggested-thread");
    for (const privateValue of [
      "synthetic-personal-refresh",
      "synthetic-career-refresh",
      "synthetic-personal-subject",
      "synthetic-career-subject",
      "tokenBlob",
    ]) {
      expect(ownerExport).not.toContain(privateValue);
    }

    expect(listInboxThreads(fixture.client.db, fixture.tenantB)).toEqual([]);
    expect(countUnresolvedNeedReply(fixture.client.db, fixture.tenantB)).toBe(0);
    const foreignExport = buildWorkspaceExport(
      fixture.client.db,
      fixture.tenantB,
      parseExportQuery(new URLSearchParams("format=json&set=all")),
      NOW,
    ).body;
    expect(foreignExport).toContain("foreign@invalid.test");
    for (const privateValue of [
      "career@invalid.test",
      "personal@invalid.test",
      "imported-thread",
      "suggested-thread",
      "Could you share two time slots?",
    ]) {
      expect(foreignExport).not.toContain(privateValue);
    }
  });
});

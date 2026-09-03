import { afterEach, describe, expect, it } from "vitest";

import { parseCsv } from "../../domain/csv-import";
import { parseExportQuery } from "../../domain/export";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { applyToOpportunity } from "./applications";
import { createCompany } from "./companies";
import { createContact } from "./contacts";
import { connectEmailAccount } from "./email-accounts";
import { recordEmailMessage, upsertEmailThread } from "./email-content";
import { buildWorkspaceExport } from "./export";
import { createOpportunity } from "./opportunities";

describe("workspace export", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function seed() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    const now = new Date("2026-09-02T10:00:00.000Z");
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
      now,
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: "microsoft",
      name: "Rahul Sharma",
      methods: [{ kind: "email", value: "rahul@invalid.test", isPrimary: true }],
      now,
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "sde",
      companyId: "microsoft",
      role: "SDE",
      jobId: "182763",
      now,
    });
    applyToOpportunity(fixture.client.db, fixture.tenantA, {
      id: "app-1",
      opportunityId: "sde",
      portal: "Careers",
      appliedOn: "2026-09-01",
      now,
    });
    createCompany(fixture.client.db, fixture.tenantB, {
      id: "hidden-co",
      name: "Hidden Co",
      now,
    });
    createContact(fixture.client.db, fixture.tenantB, {
      id: "hidden-contact",
      companyId: "hidden-co",
      name: "Other Person",
      methods: [{ kind: "email", value: "other@invalid.test", isPrimary: true }],
      now,
    });
    return { fixture, now };
  }

  it("puts a contact email in JSON and CSV and keeps the other workspace out", () => {
    const { fixture, now } = seed();
    const json = buildWorkspaceExport(
      fixture.client.db,
      fixture.tenantA,
      parseExportQuery(new URLSearchParams("format=json&set=all")),
      now,
    );
    const payload = JSON.parse(json.body) as {
      companies: Array<{ name: string }>;
      contacts: Array<{ name: string; email: string }>;
    };

    expect(payload.companies.map((row) => row.name)).toEqual(["Microsoft"]);
    expect(payload.contacts[0]).toMatchObject({
      name: "Rahul Sharma",
      email: "rahul@invalid.test",
    });
    expect(json.body).not.toContain("Hidden Co");
    expect(json.body).not.toContain("other@invalid.test");
    expect(json.body).not.toContain("passwordHash");
    expect(json.body).not.toContain("password_hash");
    expect(json.body).not.toContain("APP_PASSWORD");
    expect(json.body).not.toContain("synthetic-password-hash");
    expect(json.body).not.toContain("workspaceId");
    expect(json.body).not.toContain("workspace-b");

    const csv = buildWorkspaceExport(
      fixture.client.db,
      fixture.tenantA,
      parseExportQuery(new URLSearchParams("format=csv&set=contacts")),
      now,
    );
    const parsed = parseCsv(csv.body);
    expect(parsed.headers[0]).toBe("Name");
    expect(parsed.headers).toContain("Email");
    expect(parsed.rows[0]?.values).toContain("rahul@invalid.test");
    expect(csv.body).not.toContain("other@invalid.test");
  });

  it("does not copy APP_PASSWORD or the other workspace's rows into an export", () => {
    const { fixture, now } = seed();
    const previous = process.env.APP_PASSWORD;
    process.env.APP_PASSWORD = "env-password-must-not-leak";
    try {
      const json = buildWorkspaceExport(
        fixture.client.db,
        fixture.tenantA,
        parseExportQuery(new URLSearchParams("format=json&set=all")),
        now,
      );
      expect(json.body).toContain("rahul@invalid.test");
      expect(json.body).not.toContain("APP_PASSWORD");
      expect(json.body).not.toContain("env-password-must-not-leak");
    } finally {
      if (previous === undefined) {
        delete process.env.APP_PASSWORD;
      } else {
        process.env.APP_PASSWORD = previous;
      }
    }
  });

  it("includes owned Gmail thread metadata and bodies without credentials or foreign mail", () => {
    const { fixture, now } = seed();
    const tokenKey = Buffer.alloc(32, 18).toString("base64");
    const account = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "private-google-sub-a",
        email: "owner@invalid.test",
        refreshToken: "private-refresh-token-a",
        now,
      },
      tokenKey,
    );
    const thread = upsertEmailThread(fixture.client.db, fixture.tenantA, {
      accountId: account.id,
      gmailThreadId: "gmail-thread-a",
      subject: "Referral reply",
      contactId: "rahul",
      source: "manual_import",
      matchStatus: "manual",
      matchReason: "Linked manually",
      lastMessageAt: now,
      now,
    });
    recordEmailMessage(fixture.client.db, fixture.tenantA, {
      threadId: thread.id,
      accountId: account.id,
      gmailId: "gmail-message-a",
      direction: "inbound",
      fromEmail: "rahul@invalid.test",
      to: [account.email],
      subject: "Referral reply",
      body: "Safe exported message body",
      sentAt: now,
      now,
    });
    const foreignAccount = connectEmailAccount(
      fixture.client.db,
      fixture.tenantB,
      {
        googleSub: "private-google-sub-b",
        email: "foreign-owner@invalid.test",
        refreshToken: "private-refresh-token-b",
        now,
      },
      tokenKey,
    );
    const foreignThread = upsertEmailThread(fixture.client.db, fixture.tenantB, {
      accountId: foreignAccount.id,
      gmailThreadId: "foreign-gmail-thread",
      subject: "Foreign private mail",
      source: "manual_import",
      lastMessageAt: now,
      now,
    });
    recordEmailMessage(fixture.client.db, fixture.tenantB, {
      threadId: foreignThread.id,
      accountId: foreignAccount.id,
      gmailId: "foreign-message",
      direction: "inbound",
      fromEmail: "other@invalid.test",
      to: [foreignAccount.email],
      body: "foreign-private-body",
      sentAt: now,
      now,
    });

    const exported = buildWorkspaceExport(
      fixture.client.db,
      fixture.tenantA,
      parseExportQuery(new URLSearchParams("format=json&set=all")),
      now,
    );
    const payload = JSON.parse(exported.body) as {
      emailAccounts: Array<{ email: string }>;
      emailThreads: Array<{ gmailThreadId: string; messages: Array<{ body: string }> }>;
    };
    expect(payload.emailAccounts).toEqual([
      expect.objectContaining({ email: "owner@invalid.test" }),
    ]);
    expect(payload.emailThreads).toEqual([
      expect.objectContaining({
        gmailThreadId: "gmail-thread-a",
        messages: [expect.objectContaining({ body: "Safe exported message body" })],
      }),
    ]);
    for (const secret of [
      "private-refresh-token-a",
      "private-refresh-token-b",
      "private-google-sub-a",
      "private-google-sub-b",
      "tokenBlob",
      "foreign-private-body",
    ]) {
      expect(exported.body).not.toContain(secret);
    }
  });
});

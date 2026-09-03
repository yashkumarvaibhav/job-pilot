import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../../../test/tenant-fixture";
import { createContact } from "../../../server/repos/contacts";
import { connectEmailAccount } from "../../../server/repos/email-accounts";
import type { MailPort } from "../../../server/mail/mail-port";

const TOKEN_KEY = Buffer.alloc(32, 13).toString("base64");
const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: undefined as unknown,
  dependencies: null as unknown,
}));

vi.mock("@/server/auth/current-session", () => ({
  currentTenant: async () => mocks.tenant,
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));
vi.mock("@/server/mail/runtime", () => ({
  getMailSendDependencies: () => mocks.dependencies,
}));

import { POST } from "./route";

const ORIGIN = "https://jobpilot.invalid.test";

function request(body: unknown) {
  return new Request(`${ORIGIN}/api/compose`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("compose route", () => {
  const fixtures: { dispose: () => void }[] = [];

  beforeEach(() => {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
    mocks.dependencies = null;
  });

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  it("requires a Job Pilot session", async () => {
    mocks.tenant = null;
    expect((await POST(request({}))).status).toBe(401);
  });

  it("rejects malformed or unreviewed payloads", async () => {
    expect((await POST(request({ accountId: "a" }))).status).toBe(400);
    expect(
      (
        await POST(
          request({
            accountId: "a",
            contactId: "c",
            subject: "Hello",
            body: "Body",
            attachmentVersionIds: [],
            approval: "preview",
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("fails closed while Gmail sending configuration is absent", async () => {
    const response = await POST(
      request({
        accountId: "a",
        contactId: "c",
        subject: "Hello",
        body: "Body",
        attachmentVersionIds: [],
        approval: "send_now",
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Gmail sending is not configured yet.",
    });
  });

  it("sends only the reviewed payload through the configured port", async () => {
    const fixture = fixtures[0] as ReturnType<typeof createTenantTestFixture>;
    const account = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-a",
        email: "sender@invalid.test",
        refreshToken: "synthetic-refresh",
      },
      TOKEN_KEY,
    );
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "contact-a",
      name: "Rahul Sharma",
      methods: [
        {
          kind: "email",
          value: "rahul@invalid.test",
          isPrimary: true,
        },
      ],
    });
    const mailPort: MailPort = {
      send: vi.fn().mockResolvedValue({
        gmailMessageId: "gmail-message",
        gmailThreadId: "gmail-thread",
        rfcMessageId: "<message@jobpilot.invalid>",
        sentAt: new Date("2026-09-03T16:00:00.000Z"),
      }),
    };
    mocks.dependencies = { mailPort, tokenKey: TOKEN_KEY };

    const response = await POST(
      request({
        accountId: account.id,
        contactId: contact.id,
        opportunityId: null,
        referralId: null,
        subject: "Referral request",
        body: "Hello Rahul",
        attachmentVersionIds: [],
        approval: "send_now",
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(
      expect.objectContaining({ accountId: account.id, contactId: contact.id }),
    );
    expect(mailPort.send).toHaveBeenCalledOnce();
  });
});

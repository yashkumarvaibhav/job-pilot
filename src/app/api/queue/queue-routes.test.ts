import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../../../test/tenant-fixture";
import { createContact } from "../../../server/repos/contacts";
import { connectEmailAccount } from "../../../server/repos/email-accounts";
import { createQueueMessage } from "../../../server/repos/send-safety";

const TOKEN_KEY = Buffer.alloc(32, 23).toString("base64");
const NOW = new Date("2026-09-03T10:00:00.000Z");
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

import { GET as list } from "./route";
import { GET as detail, PATCH as update } from "./[id]/route";
import { POST as approve } from "./[id]/approve/route";

function request(path: string, body?: unknown) {
  return new Request(`https://jobpilot.invalid.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("queue routes", () => {
  const fixtures: { dispose: () => void }[] = [];
  let queueId: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
    mocks.dependencies = null;
    const account = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-a",
        email: "sender@invalid.test",
        refreshToken: "refresh-a",
        now: NOW,
      },
      TOKEN_KEY,
    );
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "contact-a",
      name: "Contact A",
      methods: [{ kind: "email", value: "recipient@invalid.test" }],
      now: NOW,
    });
    queueId = createQueueMessage(fixture.client.db, fixture.tenantA, {
      id: "queue-a",
      accountId: account.id,
      contactId: contact.id,
      origin: "one_off",
      subject: "Visible subject",
      body: "Complete private body",
      attachmentVersionIds: [],
      sendAt: new Date(NOW.valueOf() + 60_000),
      now: NOW,
    }).id;
  });

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
    vi.useRealTimers();
  });

  it("requires a session and keeps complete bodies out of list responses", async () => {
    mocks.tenant = null;
    expect((await list()).status).toBe(401);
    mocks.tenant = (fixtures[0] as ReturnType<typeof createTenantTestFixture>).tenantA;
    const response = await list();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Visible subject");
    expect(text).not.toContain("Complete private body");
  });

  it("reveals the complete body only on one owned detail", async () => {
    const response = await detail(request(`/api/queue/${queueId}`), {
      params: Promise.resolve({ id: queueId }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({ id: queueId, body: "Complete private body" }),
    );
    const fixture = fixtures[0] as ReturnType<typeof createTenantTestFixture>;
    mocks.tenant = fixture.tenantB;
    expect(
      (
        await detail(request(`/api/queue/${queueId}`), {
          params: Promise.resolve({ id: queueId }),
        })
      ).status,
    ).toBe(404);
  });

  it("approves exactly one path id and rejects every bulk-shaped request", async () => {
    for (const body of [[], { ids: [queueId] }, { all: true }, { filter: "awaiting" }]) {
      expect(
        (
          await approve(request(`/api/queue/${queueId}/approve`, body), {
            params: Promise.resolve({ id: queueId }),
          })
        ).status,
      ).toBe(400);
    }
    const response = await approve(
      request(`/api/queue/${queueId}/approve`, {
        sendAt: "2026-09-04T03:30:00.000Z",
      }),
      { params: Promise.resolve({ id: queueId }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({ id: queueId, status: "approved" }),
    );
  });

  it("holds and cancels only one owned row", async () => {
    const held = await update(
      new Request(`https://jobpilot.invalid.test/api/queue/${queueId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "hold" }),
      }),
      { params: Promise.resolve({ id: queueId }) },
    );
    expect(held.status).toBe(200);
    expect(await held.json()).toEqual(expect.objectContaining({ status: "held" }));
    const cancelled = await update(
      new Request(`https://jobpilot.invalid.test/api/queue/${queueId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      }),
      { params: Promise.resolve({ id: queueId }) },
    );
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toEqual(
      expect.objectContaining({ status: "cancelled" }),
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../../../test/tenant-fixture";
import { createContact } from "../../../server/repos/contacts";
import { connectEmailAccount } from "../../../server/repos/email-accounts";
import { createEmailTemplate } from "../../../server/repos/email-content";
import { sequenceDueSourceKey } from "../../../domain/sequence";

const TOKEN_KEY = Buffer.alloc(32, 34).toString("base64");
const NOW = new Date("2026-09-04T10:00:00.000Z");

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

import { GET as listSequences, POST as createSequenceRoute } from "./route";
import { PATCH as patchSequence } from "./[id]/route";
import { POST as enrollRoute } from "./[id]/enroll/route";
import { POST as stopRoute } from "../enrollments/[id]/stop/route";
import { GET as listQueue } from "../queue/route";
import { GET as queueDetail, PATCH as patchQueue } from "../queue/[id]/route";
import { POST as approveQueue } from "../queue/[id]/approve/route";

const ORIGIN = "https://jobpilot.invalid.test";
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonRequest = (path: string, method: string, body?: unknown) =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("sequence routes", () => {
  const fixtures: { dispose: () => void }[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
  });

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
    vi.useRealTimers();
  });

  function seed() {
    const fixture = fixtures[0] as ReturnType<typeof createTenantTestFixture>;
    const account = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-a",
        email: "sender@invalid.test",
        refreshToken: "refresh-a",
        sendingWindowStart: 0,
        sendingWindowEnd: 1439,
        now: NOW,
      },
      TOKEN_KEY,
    );
    const template = createEmailTemplate(fixture.client.db, fixture.tenantA, {
      id: "template-tiny",
      title: "Tiny follow-up",
      subject: "Hello",
      body: "Tiny template",
      now: NOW,
    });
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "contact-priya",
      name: "Priya Shah",
      methods: [{ kind: "email", value: "priya@invalid.test", isPrimary: true }],
      now: NOW,
    });
    return { fixture, account, template, contact };
  }

  it("requires authentication", async () => {
    mocks.tenant = null;
    expect((await listSequences()).status).toBe(401);
    expect(
      (await createSequenceRoute(jsonRequest("/api/sequences", "POST", {}))).status,
    ).toBe(401);
  });

  it("creates a sequence, enrolls without sending, and rejects freshness overrides", async () => {
    const { account, template, contact } = seed();
    const created = await createSequenceRoute(
      jsonRequest("/api/sequences", "POST", {
        name: "Cold email",
        steps: [
          { offsetDays: 0, templateId: template.id },
          { offsetDays: 4, templateId: template.id },
        ],
      }),
    );
    expect(created.status).toBe(201);
    const sequence = (await created.json()) as { id: string };
    const enrolled = await enrollRoute(
      jsonRequest(`/api/sequences/${sequence.id}/enroll`, "POST", {
        contactId: contact.id,
        accountId: account.id,
      }),
      context(sequence.id),
    );
    expect(enrolled.status).toBe(201);
    const enrollment = (await enrolled.json()) as {
      id: string;
      currentStepId: string;
    };
    const listed = await listQueue();
    expect(listed.status).toBe(200);
    const queue = (await listed.json()) as Array<{
      id: string;
      subject: string;
      origin: string;
      status: string;
    }>;
    expect(queue.some((row) => row.subject === "Review follow-up email")).toBe(true);
    const reviewId = sequenceDueSourceKey(enrollment.id, enrollment.currentStepId);
    const detail = await queueDetail(jsonRequest(`/api/queue/${reviewId}`, "GET"), context(reviewId));
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual(
      expect.objectContaining({
        origin: "sequence",
        sendAnywayAvailable: false,
        body: expect.stringContaining("Tiny template"),
      }),
    );
    const overridden = await approveQueue(
      jsonRequest(`/api/queue/${reviewId}/approve`, "POST", {
        sendAt: "2026-09-04T15:30",
        sendAnyway: true,
      }),
      context(reviewId),
    );
    expect(overridden.status).toBe(409);
    expect(await overridden.json()).toEqual({
      error: "Sequence messages cannot skip the mailbox freshness check.",
    });
    const approved = await approveQueue(
      jsonRequest(`/api/queue/${reviewId}/approve`, "POST", {
        sendAt: "2026-09-04T15:30",
      }),
      context(reviewId),
    );
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual(expect.objectContaining({ status: "approved" }));
    const patched = await patchSequence(
      jsonRequest(`/api/sequences/${sequence.id}`, "PATCH", {
        name: "Cold outreach",
      }),
      context(sequence.id),
    );
    expect(patched.status).toBe(200);
    const stopped = await stopRoute(
      jsonRequest(`/api/enrollments/${enrollment.id}/stop`, "POST", {}),
      context(enrollment.id),
    );
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toEqual(
      expect.objectContaining({ status: "cancelled", cancelReason: "manual_stop" }),
    );
    const gone = await queueDetail(
      jsonRequest(`/api/queue/${reviewId}`, "GET"),
      context(reviewId),
    );
    expect(gone.status).toBe(404);
  });

  it("keeps another workspace's sequence hidden", async () => {
    const { account, template, contact, fixture } = seed();
    const created = await createSequenceRoute(
      jsonRequest("/api/sequences", "POST", {
        name: "Owned",
        steps: [{ offsetDays: 0, templateId: template.id }],
      }),
    );
    const sequence = (await created.json()) as { id: string };
    await enrollRoute(
      jsonRequest(`/api/sequences/${sequence.id}/enroll`, "POST", {
        contactId: contact.id,
        accountId: account.id,
      }),
      context(sequence.id),
    );
    mocks.tenant = fixture.tenantB;
    const listed = await listSequences();
    expect(((await listed.json()) as { sequences: unknown[] }).sequences).toEqual([]);
    expect(
      (
        await enrollRoute(
          jsonRequest(`/api/sequences/${sequence.id}/enroll`, "POST", {
            contactId: contact.id,
            accountId: account.id,
          }),
          context(sequence.id),
        )
      ).status,
    ).toBe(404);
    expect((await patchQueue(
      jsonRequest("/api/queue/missing", "PATCH", { action: "cancel", sendAnyway: true }),
      context("missing"),
    )).status).toBe(400);
  });
});

import { afterEach, describe, expect, it } from "vitest";

import { DIGEST_SUBJECT, formatDigestBody } from "../../domain/digest";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createContact } from "./contacts";
import {
  DigestInputError,
  listDigestRuns,
  processDueDigests,
  readDigestPolicy,
  readDigestPreview,
  updateDigestPolicy,
} from "./digest";
import {
  connectEmailAccount,
  disconnectEmailAccount,
  setDefaultEmailAccount,
} from "./email-accounts";
import { createQueueMessage, listQueueMessages } from "./send-safety";
import { getTodaySnapshot } from "./today";

const TOKEN_KEY = Buffer.alloc(32, 19).toString("base64");
const KOLKATA_EIGHT = new Date("2026-09-04T02:30:00.000Z");
const KOLKATA_SEVEN = new Date("2026-09-04T01:30:00.000Z");
const NEW_YORK_EIGHT = new Date("2026-09-04T12:00:00.000Z");

describe("morning digest", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function setup() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    const accountA = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-a",
        email: "owner-a@invalid.test",
        refreshToken: "refresh-a",
        now: KOLKATA_EIGHT,
      },
      TOKEN_KEY,
    );
    const accountASecond = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-a-second",
        email: "career-a@invalid.test",
        refreshToken: "refresh-a-second",
        now: KOLKATA_EIGHT,
      },
      TOKEN_KEY,
    );
    const accountB = connectEmailAccount(
      fixture.client.db,
      fixture.tenantB,
      {
        googleSub: "google-b",
        email: "owner-b@invalid.test",
        refreshToken: "refresh-b",
        now: KOLKATA_EIGHT,
      },
      TOKEN_KEY,
    );
    return { fixture, accountA, accountASecond, accountB };
  }

  it("defaults to preview-only and does not queue until opt-in is live", () => {
    const { fixture, accountA } = setup();
    const db = fixture.client.db;
    expect(readDigestPolicy(db, fixture.tenantA)).toMatchObject({
      digestEmailEnabled: false,
      digestAccountId: null,
      digestHour: null,
    });

    updateDigestPolicy(db, fixture.tenantA, {
      digestHour: 8,
      digestAccountId: accountA.id,
      digestEmailEnabled: false,
      now: KOLKATA_EIGHT,
    });
    processDueDigests(db, KOLKATA_EIGHT);

    expect(listQueueMessages(db, fixture.tenantA)).toEqual([]);
    const preview = readDigestPreview(db, fixture.tenantA, KOLKATA_EIGHT);
    expect(preview.body).toBe(formatDigestBody(preview.counts));
    expect(preview.counts).toEqual(
      expect.objectContaining({
        followUps: getTodaySnapshot(db, fixture.tenantA, { now: KOLKATA_EIGHT })
          .stats.followUps,
      }),
    );
    expect(listDigestRuns(db, fixture.tenantA)[0]?.outcome).toBe("previewed");
  });

  it("queues one approved self-digest to the selected account and is idempotent that morning", () => {
    const { fixture, accountA, accountASecond } = setup();
    const db = fixture.client.db;
    createContact(db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      followUpOn: "2026-09-04",
      now: KOLKATA_EIGHT,
    });
    setDefaultEmailAccount(db, fixture.tenantA, accountASecond.id);
    updateDigestPolicy(db, fixture.tenantA, {
      digestHour: 8,
      digestAccountId: accountA.id,
      digestEmailEnabled: true,
      now: KOLKATA_EIGHT,
    });

    processDueDigests(db, KOLKATA_EIGHT);
    processDueDigests(db, KOLKATA_EIGHT);

    const queued = listQueueMessages(db, fixture.tenantA);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      origin: "self_digest",
      status: "approved",
      approvalKind: "self_digest_policy",
      accountId: accountA.id,
      recipient: "owner-a@invalid.test",
      subject: DIGEST_SUBJECT,
    });
    expect(queued[0]?.approvalHash).toBe(queued[0]?.payloadHash);
    expect(queued[0]?.accountId).not.toBe(accountASecond.id);
    const today = getTodaySnapshot(db, fixture.tenantA, { now: KOLKATA_EIGHT });
    expect(queued[0]?.body).toBe(
      formatDigestBody({
        followUps: today.stats.followUps,
        deadlines: today.stats.deadlines,
        oa: today.pipeline.oa,
        replies: today.stats.needReply,
        interviewsToday: today.stats.interviewsToday,
      }),
    );
  });

  it("keeps two workspaces on independent local dates, counts and accounts", () => {
    const { fixture, accountA, accountB } = setup();
    const db = fixture.client.db;
    const newYorkSeven = new Date("2026-09-04T11:00:00.000Z");
    createContact(db, fixture.tenantA, {
      id: "contact-a",
      name: "Priya Nair",
      followUpOn: "2026-09-04",
      now: newYorkSeven,
    });
    createContact(db, fixture.tenantB, {
      id: "contact-b1",
      name: "Other Person",
      followUpOn: "2026-09-04",
      now: newYorkSeven,
    });
    createContact(db, fixture.tenantB, {
      id: "contact-b2",
      name: "Second Person",
      followUpOn: "2026-09-04",
      now: newYorkSeven,
    });
    updateDigestPolicy(db, fixture.tenantA, {
      digestHour: 8,
      digestAccountId: accountA.id,
      digestEmailEnabled: true,
      now: newYorkSeven,
    });
    updateDigestPolicy(db, fixture.tenantB, {
      digestHour: 8,
      digestAccountId: accountB.id,
      digestEmailEnabled: true,
      now: newYorkSeven,
    });

    processDueDigests(db, newYorkSeven);
    expect(listQueueMessages(db, fixture.tenantA)).toHaveLength(1);
    expect(listQueueMessages(db, fixture.tenantB)).toHaveLength(0);

    processDueDigests(db, NEW_YORK_EIGHT);
    const queuedA = listQueueMessages(db, fixture.tenantA);
    const queuedB = listQueueMessages(db, fixture.tenantB);
    expect(queuedA).toHaveLength(1);
    expect(queuedB).toHaveLength(1);
    expect(queuedA[0]?.accountId).toBe(accountA.id);
    expect(queuedA[0]?.recipient).toBe("owner-a@invalid.test");
    expect(queuedB[0]?.accountId).toBe(accountB.id);
    expect(queuedB[0]?.recipient).toBe("owner-b@invalid.test");
    expect(queuedA[0]?.body).toContain("1 follow-up due");
    expect(queuedB[0]?.body).toContain("2 follow-ups due");
    expect(listDigestRuns(db, fixture.tenantA)[0]?.localDate).toBe("2026-09-04");
    expect(listDigestRuns(db, fixture.tenantB)[0]?.localDate).toBe("2026-09-04");
  });

  it("skips a disconnected account with an execution row and no exception", () => {
    const { fixture, accountA } = setup();
    const db = fixture.client.db;
    updateDigestPolicy(db, fixture.tenantA, {
      digestHour: 8,
      digestAccountId: accountA.id,
      digestEmailEnabled: true,
      now: KOLKATA_EIGHT,
    });
    fixture.client.sqlite
      .prepare("update email_account set status = 'disconnected' where id = ?")
      .run(accountA.id);

    expect(() => processDueDigests(db, KOLKATA_EIGHT)).not.toThrow();
    expect(listQueueMessages(db, fixture.tenantA)).toEqual([]);
    expect(listDigestRuns(db, fixture.tenantA)[0]).toMatchObject({
      outcome: "skipped_disconnected",
      localDate: "2026-09-04",
    });
    expect(readDigestPolicy(db, fixture.tenantA).digestEmailEnabled).toBe(false);
  });

  it("cannot use self-digest approval for a different recipient", () => {
    const { fixture, accountA } = setup();
    const row = createQueueMessage(fixture.client.db, fixture.tenantA, {
      accountId: accountA.id,
      origin: "self_digest",
      recipient: "other@invalid.test",
      subject: DIGEST_SUBJECT,
      body: formatDigestBody({
        followUps: 0,
        deadlines: 0,
        oa: 0,
        replies: 0,
        interviewsToday: 0,
      }),
      attachmentVersionIds: [],
      sendAt: KOLKATA_EIGHT,
      approvalKind: "self_digest_policy",
      now: KOLKATA_EIGHT,
    });
    expect(row).toMatchObject({
      status: "awaiting_approval",
      approvalKind: null,
      recipient: "other@invalid.test",
    });
  });

  it("turns the policy off when another account is selected until it is confirmed", () => {
    const { fixture, accountA, accountASecond } = setup();
    const db = fixture.client.db;
    updateDigestPolicy(db, fixture.tenantA, {
      digestHour: 8,
      digestAccountId: accountA.id,
      digestEmailEnabled: true,
      now: KOLKATA_EIGHT,
    });
    const switched = updateDigestPolicy(db, fixture.tenantA, {
      digestAccountId: accountASecond.id,
      now: KOLKATA_EIGHT,
    });
    expect(switched.digestEmailEnabled).toBe(false);
    expect(switched.digestAccountId).toBe(accountASecond.id);
    expect(switched.digestAccountEmail).toBeNull();

    processDueDigests(db, KOLKATA_EIGHT);
    expect(listQueueMessages(db, fixture.tenantA)).toEqual([]);

    const confirmed = updateDigestPolicy(db, fixture.tenantA, {
      digestAccountId: accountASecond.id,
      digestEmailEnabled: true,
      now: KOLKATA_EIGHT,
    });
    expect(confirmed.digestEmailEnabled).toBe(true);
    expect(confirmed.digestAccountEmail).toBe("career-a@invalid.test");
  });

  it("does not retarget the digest when the default sender changes", () => {
    const { fixture, accountA, accountASecond } = setup();
    const db = fixture.client.db;
    updateDigestPolicy(db, fixture.tenantA, {
      digestHour: 8,
      digestAccountId: accountA.id,
      digestEmailEnabled: true,
      now: KOLKATA_EIGHT,
    });
    setDefaultEmailAccount(db, fixture.tenantA, accountASecond.id);
    expect(readDigestPolicy(db, fixture.tenantA)).toMatchObject({
      digestAccountId: accountA.id,
      digestEmailEnabled: true,
      digestAccountEmail: "owner-a@invalid.test",
    });
    disconnectEmailAccount(db, fixture.tenantA, accountA.id, KOLKATA_EIGHT);
    expect(readDigestPolicy(db, fixture.tenantA).digestEmailEnabled).toBe(false);
  });

  it("disables the policy when the selected account's address changes", () => {
    const { fixture, accountA } = setup();
    const db = fixture.client.db;
    updateDigestPolicy(db, fixture.tenantA, {
      digestHour: 8,
      digestAccountId: accountA.id,
      digestEmailEnabled: true,
      now: KOLKATA_EIGHT,
    });
    connectEmailAccount(
      db,
      fixture.tenantA,
      {
        googleSub: "google-a",
        email: "renamed-a@invalid.test",
        refreshToken: "refresh-a",
        now: KOLKATA_EIGHT,
      },
      TOKEN_KEY,
    );
    expect(readDigestPolicy(db, fixture.tenantA)).toMatchObject({
      digestAccountId: accountA.id,
      digestEmailEnabled: false,
    });
  });

  it("does nothing before digest hour and rejects a foreign account id", () => {
    const { fixture, accountA, accountB } = setup();
    const db = fixture.client.db;
    updateDigestPolicy(db, fixture.tenantA, {
      digestHour: 8,
      digestAccountId: accountA.id,
      digestEmailEnabled: true,
      now: KOLKATA_SEVEN,
    });
    processDueDigests(db, KOLKATA_SEVEN);
    expect(listQueueMessages(db, fixture.tenantA)).toEqual([]);
    expect(listDigestRuns(db, fixture.tenantA)).toEqual([]);

    expect(() =>
      updateDigestPolicy(db, fixture.tenantA, {
        digestAccountId: accountB.id,
        digestEmailEnabled: true,
      }),
    ).toThrow(DigestInputError);
    expect(readDigestPolicy(db, fixture.tenantB).digestEmailEnabled).toBe(false);
  });
});

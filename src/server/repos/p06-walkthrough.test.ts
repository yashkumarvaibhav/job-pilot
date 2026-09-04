import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { OpportunityHealthBanner } from "../../components/opportunity-health";
import { StaleFlag } from "../../components/stale-chip";
import { DIGEST_SUBJECT, formatDigestBody } from "../../domain/digest";
import { opportunityHealth } from "../../domain/opportunity-health";
import { calendarDateInZone, shiftCalendarDate } from "../../domain/referral";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import type { MailPort, MailSendRequest } from "../mail/mail-port";
import { flushSendQueue } from "../jobs/send-queue";
import { createCompany } from "./companies";
import { createContact } from "./contacts";
import {
  listDigestRuns,
  processDueDigests,
  readDigestPolicy,
  readDigestPreview,
  updateDigestPolicy,
} from "./digest";
import {
  connectEmailAccount,
  listEmailAccounts,
  setDefaultEmailAccount,
} from "./email-accounts";
import { createOpportunity, getOpportunity } from "./opportunities";
import { createReferral } from "./referrals";
import { listStaleIndex } from "./rules";
import { getScoredOpportunity } from "./scoring";
import { listQueueMessages, queueAccountUsage } from "./send-safety";
import { updateWorkspaceSettings } from "./settings";
import { getTodaySnapshot } from "./today";

const TOKEN_KEY = Buffer.alloc(32, 40).toString("base64");
const KOLKATA_EIGHT = new Date("2026-09-04T02:30:00.000Z");
const NEW_YORK_SEVEN = new Date("2026-09-04T11:00:00.000Z");
const NEW_YORK_EIGHT = new Date("2026-09-04T12:00:00.000Z");
const STALE_AT = new Date("2026-08-13T08:30:00.000Z");

function mailPort() {
  return {
    send: vi.fn(async (request: MailSendRequest) => ({
      gmailMessageId: `gmail-${request.to[0]}`,
      gmailThreadId: `thread-${request.to[0]}`,
      rfcMessageId: request.rfcMessageId!,
      sentAt: KOLKATA_EIGHT,
    })),
  } satisfies MailPort;
}

describe("P06 morning-digest walkthrough", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("owns digest settings and preview routes and has no bulk path", () => {
    const digestApi = join(process.cwd(), "src/app/api/settings/digest");
    expect(readdirSync(digestApi)).toEqual(
      expect.arrayContaining(["preview", "route.ts"]),
    );
    expect(readdirSync(join(digestApi, "preview"))).toEqual(["route.ts"]);
    expect(readdirSync(digestApi).some((name) => /bulk|all/i.test(name))).toBe(
      false,
    );

    const panel = readFileSync(
      join(process.cwd(), "src/components/morning-digest-panel.tsx"),
      "utf8",
    );
    expect(panel).toContain("Digest address");
    expect(panel).toContain("readOnly");
    expect(panel).not.toContain('name="recipient"');
    expect(panel).not.toContain("Email my morning digest");
    expect(panel).toContain("DIGEST_EMAIL_LABEL");
  });

  it("walks stale, health, scoring, quiet hours and isolated self-digest", async () => {
    const fixture = createTenantTestFixture();
    cleanups.push(fixture.dispose);
    const db = fixture.client.db;
    const a = fixture.tenantA;
    const b = fixture.tenantB;
    const asOfOn = calendarDateInZone("Asia/Kolkata", KOLKATA_EIGHT);
    const deadlineOn = shiftCalendarDate(asOfOn, 2);
    const port = mailPort();

    createCompany(db, a, {
      id: "quiet-corp",
      name: "Quiet Corp",
      now: STALE_AT,
    });
    const silent = createOpportunity(db, a, {
      id: "silent-role",
      companyId: "quiet-corp",
      role: "Platform Engineer",
      bucket: "active",
      now: STALE_AT,
    });
    const staleMarks = listStaleIndex(db, a, asOfOn).opportunity.get(silent.id);
    expect(
      staleMarks?.some((mark) => mark.reason.startsWith("No activity for")),
    ).toBe(true);
    const staleHtml = renderToStaticMarkup(
      createElement(StaleFlag, { reasons: staleMarks ?? [] }),
    );
    expect(staleHtml).toContain("Stale");
    expect(staleHtml).toContain('aria-hidden="true"');
    expect(staleHtml).toContain("No activity for");

    createCompany(db, a, {
      id: "target",
      name: "Target Company",
      target: true,
    });
    createContact(db, a, {
      id: "referrer",
      companyId: "target",
      name: "Synthetic Referrer",
      now: KOLKATA_EIGHT,
    });
    createOpportunity(db, a, {
      id: "deadline-role",
      companyId: "target",
      role: "New Grad Engineer",
      deadlineOn,
      now: KOLKATA_EIGHT,
    });
    createReferral(db, a, {
      id: "received-referral",
      contactId: "referrer",
      opportunityId: "deadline-role",
      channel: "email",
      stage: "referral_received",
      todayOn: asOfOn,
      now: KOLKATA_EIGHT,
    });
    const health = opportunityHealth(
      {
        deadlineOn,
        hasApplication: false,
        referralAvailable: true,
      },
      asOfOn,
    );
    expect(health?.title).toBe("Action required");
    expect(health?.sentence).toBe(`Apply before ${deadlineOn}.`);
    const scoredBefore = getScoredOpportunity(db, a, "deadline-role", asOfOn);
    expect(scoredBefore?.score).toBe(8);
    const healthHtml = renderToStaticMarkup(
      createElement(OpportunityHealthBanner, {
        health: health!,
        score: scoredBefore!.score,
      }),
    );
    expect(healthHtml).toContain("Action required");
    expect(healthHtml).toContain(`Apply before ${deadlineOn}.`);
    expect(healthHtml).toContain('aria-label="Priority score 8"');

    updateWorkspaceSettings(db, a, {
      displayName: "Tenant A",
      scoringWeights: { targetCompany: 0 },
    });
    expect(getScoredOpportunity(db, a, "deadline-role", asOfOn)?.score).toBe(5);

    createContact(db, a, {
      id: "rahul",
      name: "Rahul Sharma",
      followUpOn: asOfOn,
      now: KOLKATA_EIGHT,
    });

    const personal = connectEmailAccount(
      db,
      a,
      {
        googleSub: "synthetic-personal",
        email: "personal@invalid.test",
        refreshToken: "synthetic-personal-refresh",
        now: KOLKATA_EIGHT,
      },
      TOKEN_KEY,
    );
    const career = connectEmailAccount(
      db,
      a,
      {
        googleSub: "synthetic-career",
        email: "career@invalid.test",
        refreshToken: "synthetic-career-refresh",
        now: KOLKATA_EIGHT,
      },
      TOKEN_KEY,
    );
    expect(setDefaultEmailAccount(db, a, personal.id, KOLKATA_EIGHT)).toBe(true);

    updateDigestPolicy(db, a, {
      digestHour: 8,
      digestAccountId: career.id,
      digestEmailEnabled: false,
      now: KOLKATA_EIGHT,
    });
    processDueDigests(db, KOLKATA_EIGHT);
    expect(listQueueMessages(db, a)).toEqual([]);
    const previewOff = readDigestPreview(db, a, KOLKATA_EIGHT);
    const todayOff = getTodaySnapshot(db, a, { now: KOLKATA_EIGHT });
    expect(previewOff.counts).toEqual({
      followUps: todayOff.stats.followUps,
      deadlines: todayOff.stats.deadlines,
      oa: todayOff.pipeline.oa,
      replies: todayOff.stats.needReply,
      interviewsToday: todayOff.stats.interviewsToday,
    });
    expect(previewOff.body).toBe(formatDigestBody(previewOff.counts));
    expect(listDigestRuns(db, a)[0]?.outcome).toBe("previewed");

    updateDigestPolicy(db, a, {
      digestAccountId: career.id,
      digestEmailEnabled: true,
      now: KOLKATA_EIGHT,
    });
    updateWorkspaceSettings(db, a, {
      displayName: "Tenant A",
      quietStart: "00:00",
      quietEnd: "09:00",
    });
    processDueDigests(db, KOLKATA_EIGHT);
    expect(listQueueMessages(db, a)).toEqual([]);
    expect(listDigestRuns(db, a)[0]?.outcome).toBe("skipped_quiet");

    updateWorkspaceSettings(db, a, {
      displayName: "Tenant A",
      quietStart: "",
      quietEnd: "",
    });
    processDueDigests(db, KOLKATA_EIGHT);
    processDueDigests(db, KOLKATA_EIGHT);

    const queued = listQueueMessages(db, a);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      origin: "self_digest",
      status: "approved",
      approvalKind: "self_digest_policy",
      accountId: career.id,
      recipient: "career@invalid.test",
      subject: DIGEST_SUBJECT,
    });
    expect(queued[0]?.accountId).not.toBe(personal.id);
    expect(queued[0]?.body).toBe(formatDigestBody(previewOff.counts));
    expect(
      listEmailAccounts(db, a).find((account) => account.id === personal.id)
        ?.isDefault,
    ).toBe(true);
    expect(readDigestPolicy(db, a)).toMatchObject({
      digestAccountId: career.id,
      digestEmailEnabled: true,
      digestAccountEmail: "career@invalid.test",
    });

    await flushSendQueue(
      db,
      { mailPort: port, tokenKey: TOKEN_KEY },
      { now: KOLKATA_EIGHT, maxSends: 100 },
    );
    expect(port.send).toHaveBeenCalledTimes(1);
    expect(port.send.mock.calls[0]?.[0]).toMatchObject({
      fromEmail: "career@invalid.test",
      to: ["career@invalid.test"],
      subject: DIGEST_SUBJECT,
    });
    expect(listQueueMessages(db, a)[0]?.status).toBe("sent");
    expect(
      queueAccountUsage(db, a, KOLKATA_EIGHT).find(
        (account) => account.id === career.id,
      ),
    ).toMatchObject({ sentToday: 1 });
    expect(
      queueAccountUsage(db, a, KOLKATA_EIGHT).find(
        (account) => account.id === personal.id,
      ),
    ).toMatchObject({ sentToday: 0 });

    const accountB = connectEmailAccount(
      db,
      b,
      {
        googleSub: "synthetic-foreign",
        email: "owner-b@invalid.test",
        refreshToken: "synthetic-foreign-refresh",
        now: NEW_YORK_SEVEN,
      },
      TOKEN_KEY,
    );
    createContact(db, b, {
      id: "contact-b1",
      name: "Other Person",
      followUpOn: "2026-09-04",
      now: NEW_YORK_SEVEN,
    });
    createContact(db, b, {
      id: "contact-b2",
      name: "Second Person",
      followUpOn: "2026-09-04",
      now: NEW_YORK_SEVEN,
    });
    updateDigestPolicy(db, b, {
      digestHour: 8,
      digestAccountId: accountB.id,
      digestEmailEnabled: true,
      now: NEW_YORK_SEVEN,
    });

    processDueDigests(db, NEW_YORK_SEVEN);
    expect(listQueueMessages(db, a).filter((row) => row.origin === "self_digest")).toHaveLength(
      1,
    );
    expect(listQueueMessages(db, b)).toEqual([]);

    processDueDigests(db, NEW_YORK_EIGHT);
    const queuedB = listQueueMessages(db, b);
    expect(queuedB).toHaveLength(1);
    expect(queuedB[0]).toMatchObject({
      origin: "self_digest",
      accountId: accountB.id,
      recipient: "owner-b@invalid.test",
      subject: DIGEST_SUBJECT,
    });
    expect(queuedB[0]?.body).toContain("2 follow-ups due");
    expect(listQueueMessages(db, a)).toHaveLength(1);

    await flushSendQueue(
      db,
      { mailPort: port, tokenKey: TOKEN_KEY },
      { now: NEW_YORK_EIGHT, maxSends: 100 },
    );
    expect(port.send).toHaveBeenCalledTimes(2);
    expect(port.send.mock.calls[1]?.[0]).toMatchObject({
      fromEmail: "owner-b@invalid.test",
      to: ["owner-b@invalid.test"],
    });

    expect(getOpportunity(db, b, silent.id)).toBeUndefined();
    expect(getOpportunity(db, b, "deadline-role")).toBeUndefined();
    expect(getScoredOpportunity(db, b, "deadline-role", asOfOn)).toBeUndefined();
    expect(listDigestRuns(db, b)[0]?.accountId).toBe(accountB.id);
    expect(listDigestRuns(db, a)[0]?.accountId).toBe(career.id);
    expect(
      listQueueMessages(db, b).every(
        (row) => row.accountId === accountB.id && row.recipient === "owner-b@invalid.test",
      ),
    ).toBe(true);
    expect(
      listQueueMessages(db, a).every(
        (row) =>
          row.accountId === career.id && row.recipient === "career@invalid.test",
      ),
    ).toBe(true);
  });
});

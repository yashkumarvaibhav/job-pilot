import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { rolledUpPipelineStage } from "../../domain/application";
import { todayDoNowHeading } from "../../domain/today";
import { calendarDateInZone, shiftCalendarDate } from "../../domain/referral";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { listApplications, applyToOpportunity } from "./applications";
import { createCompany, getCompany, listCompanies } from "./companies";
import { createContact, getContact, listContacts, updateContact } from "./contacts";
import { createDocument, storeDocumentVersion } from "./documents";
import { createInteraction } from "./interactions";
import {
  createOpportunity,
  createOpportunityFromConversation,
  getOpportunity,
  linkContactToOpportunity,
  listOpportunities,
  listOpportunityContacts,
  updateOpportunity,
} from "./opportunities";
import {
  createReferral,
  getReferral,
  listReferrals,
  updateReferral,
} from "./referrals";
import { getTodaySnapshot } from "./today";

describe("P01 walkthrough", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    const uploadsRoot = mkdtempSync(join(tmpdir(), "job-pilot-walkthrough-"));
    fixtures.push({
      dispose: () => {
        fixture.dispose();
        rmSync(uploadsRoot, { force: true, recursive: true });
      },
    });
    return { ...fixture, uploadsRoot };
  }

  const now = new Date("2026-09-02T02:00:00.000Z");

  it("runs networking-first and job-first without Gmail, and isolates a second account", () => {
    const fixture = newFixture();
    const db = fixture.client.db;
    const a = fixture.tenantA;
    const b = fixture.tenantB;
    const uploadsRoot = fixture.uploadsRoot;
    const asOfOn = calendarDateInZone("Asia/Kolkata", now);
    const tomorrowOn = shiftCalendarDate(asOfOn, 1);

    const tables = fixture.client.sqlite
      .prepare("select name from sqlite_master where type = 'table'")
      .all() as { name: string }[];
    expect(
      tables.some((row) => /gmail|oauth/i.test(row.name)),
    ).toBe(false);

    const neha = createContact(db, a, {
      id: "neha",
      companyName: "Microsoft",
      name: "Neha Gupta",
      relationship: "friend",
      now,
    });
    expect(listOpportunities(db, a)).toEqual([]);
    expect(neha.companyName).toBe("Microsoft");
    expect(getCompany(db, b, neha.companyId ?? "")).toBeUndefined();

    createInteraction(db, a, {
      contactId: neha.id,
      channel: "whatsapp",
      direction: "outbound",
      body: "Asking about openings at Microsoft.",
      now,
    });
    updateContact(db, a, neha.id, {
      networkingStatus: "checking_for_openings",
      nextAction: "Follow up",
      followUpOn: tomorrowOn,
    });

    const tomorrowSnapshot = getTodaySnapshot(db, a, { now });
    expect(tomorrowSnapshot.asOfOn).toBe(asOfOn);
    expect(
      tomorrowSnapshot.doNow.some((row) => row.entityId === neha.id),
    ).toBe(false);

    updateContact(db, a, neha.id, { followUpOn: asOfOn });
    const dueToday = getTodaySnapshot(db, a, { now });
    const nehaRow = dueToday.doNow.find((row) => row.entityId === neha.id);
    expect(nehaRow).toBeDefined();
    expect(
      todayDoNowHeading(nehaRow!.sourceKey, nehaRow!.verb, nehaRow!.entityLabel),
    ).toBe("Follow up with Neha Gupta");

    const microsoftSde = createOpportunityFromConversation(db, a, {
      id: "microsoft-sde-ii",
      contactId: neha.id,
      role: "SDE II",
      now,
    });
    expect(microsoftSde?.companyName).toBe("Microsoft");
    expect(microsoftSde?.role).toBe("SDE II");
    expect(
      listOpportunityContacts(db, a, microsoftSde!.id).map(
        (row) => row.contactId,
      ),
    ).toEqual([neha.id]);

    const requested = createReferral(db, a, {
      id: "neha-microsoft-referral",
      contactId: neha.id,
      opportunityId: microsoftSde!.id,
      channel: "whatsapp",
      stage: "requested",
      requestedOn: asOfOn,
      todayOn: asOfOn,
      now,
    });
    expect(requested).toBeDefined();
    expect(requested?.stage).toBe("requested");

    applyToOpportunity(db, a, {
      opportunityId: microsoftSde!.id,
      portal: "Careers",
      appliedOn: asOfOn,
      now,
    });
    const appliedMicrosoft = getOpportunity(db, a, microsoftSde!.id);
    expect(
      rolledUpPipelineStage(
        appliedMicrosoft!.stage,
        appliedMicrosoft!.application?.stage,
      ).label,
    ).toBe("Applied");

    const atlassian = createCompany(db, a, {
      id: "atlassian",
      name: "Atlassian",
      now,
    });
    const atlassianSde = createOpportunity(db, a, {
      id: "atlassian-sde",
      companyId: atlassian.id,
      role: "SDE",
      now,
    });
    expect(linkContactToOpportunity(db, a, atlassianSde.id, neha.id, now)).toEqual(
      expect.objectContaining({ contactId: neha.id }),
    );

    const atlassianReferral = createReferral(db, a, {
      id: "neha-atlassian-referral",
      contactId: neha.id,
      opportunityId: atlassianSde.id,
      channel: "whatsapp",
      stage: "requested",
      requestedOn: asOfOn,
      todayOn: asOfOn,
      now,
    });
    expect(atlassianReferral).toBeDefined();
    expect(
      updateReferral(db, a, atlassianReferral!.id, {
        stage: "referral_received",
        todayOn: asOfOn,
        now,
      })?.stage,
    ).toBe("referral_received");

    updateOpportunity(db, a, atlassianSde.id, {
      nextAction: "Apply using referral",
      nextActionDue: asOfOn,
    });
    const jobFirstToday = getTodaySnapshot(db, a, { now });
    expect(
      jobFirstToday.doNow.some(
        (row) =>
          row.entityId === atlassianSde.id &&
          row.title === "Apply using referral",
      ),
    ).toBe(true);

    // §39: the application records which stored version was used, not a typed label.
    createDocument(db, a, { id: "doc-backend", name: "Backend Resume", now });
    const backendV4 = storeDocumentVersion(
      db,
      a,
      {
        id: "version-backend-4",
        documentId: "doc-backend",
        label: "v4",
        bytes: new Uint8Array([37, 80, 68, 70]),
        contentType: "application/pdf",
        now,
      },
      uploadsRoot,
    );
    applyToOpportunity(db, a, {
      opportunityId: atlassianSde.id,
      portal: "Workday",
      appliedOn: asOfOn,
      resumeVersionId: backendV4.id,
      now,
    });
    const appliedAtlassian = getOpportunity(db, a, atlassianSde.id);
    expect(appliedAtlassian?.application?.resumeVersionId).toBe(
      "version-backend-4",
    );
    expect(
      rolledUpPipelineStage(
        appliedAtlassian!.stage,
        appliedAtlassian!.application?.stage,
      ).label,
    ).toBe("Applied");

    expect(listCompanies(db, b)).toEqual([]);
    expect(listContacts(db, b)).toEqual([]);
    expect(listOpportunities(db, b)).toEqual([]);
    expect(listApplications(db, b)).toEqual([]);
    expect(listReferrals(db, b, { asOfOn })).toEqual([]);
    expect(getContact(db, b, neha.id)).toBeUndefined();
    expect(getOpportunity(db, b, microsoftSde!.id)).toBeUndefined();
    expect(getOpportunity(db, b, atlassianSde.id)).toBeUndefined();
    expect(getReferral(db, b, requested!.id)).toBeUndefined();
    const emptyToday = getTodaySnapshot(db, b, { now });
    expect(emptyToday.doNow).toEqual([]);
    expect(emptyToday.pipeline.applied).toBe(0);
    expect(emptyToday.stats.followUps).toBe(0);

    expect(getContact(db, a, neha.id)?.name).toBe("Neha Gupta");
    expect(listContacts(db, a).map((row) => row.name)).toEqual(["Neha Gupta"]);
  });
});

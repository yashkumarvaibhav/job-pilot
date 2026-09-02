import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DuplicateConflictError, DUPLICATE_JOB_WARNING } from "../../domain/duplicate";
import { documentVersionLabel } from "../../domain/document";
import { parseExportQuery } from "../../domain/export";
import { calendarDateInZone } from "../../domain/referral";
import { todayDoNowHeading } from "../../domain/today";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { applyToOpportunity, listApplications } from "./applications";
import { createCompany, listCompanies } from "./companies";
import {
  createContact,
  getContact,
  listContacts,
  parseContactListFilter,
} from "./contacts";
import { createDocument, getDocumentVersion, storeDocumentVersion } from "./documents";
import { buildWorkspaceExport } from "./export";
import { createInterview } from "./interviews";
import {
  listNotifications,
  materializeNotifications,
  snoozeNotificationsByPreset,
} from "./notifications";
import {
  createOpportunity,
  getOpportunity,
  listOpportunities,
} from "./opportunities";
import { readWorkspaceSettings, updateWorkspaceSettings } from "./settings";
import { getTodaySnapshot } from "./today";

describe("P02 walkthrough", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    const uploadsRoot = mkdtempSync(join(tmpdir(), "job-pilot-p02-"));
    fixtures.push({
      dispose: () => {
        fixture.dispose();
        rmSync(uploadsRoot, { force: true, recursive: true });
      },
    });
    return { ...fixture, uploadsRoot };
  }

  const now = new Date("2026-09-03T08:30:00.000Z");

  it("runs a weekday without Gmail and isolates a second account", () => {
    const fixture = newFixture();
    const db = fixture.client.db;
    const a = fixture.tenantA;
    const b = fixture.tenantB;
    const asOfOn = calendarDateInZone("Asia/Kolkata", now);

    const tables = fixture.client.sqlite
      .prepare("select name from sqlite_master where type = 'table'")
      .all() as { name: string }[];
    expect(tables.some((row) => /gmail|oauth/i.test(row.name))).toBe(false);

    const microsoft = createCompany(db, a, {
      id: "microsoft",
      name: "Microsoft",
      now,
    });
    const rahul = createContact(db, a, {
      id: "rahul",
      companyId: microsoft.id,
      name: "Rahul Sharma",
      relationship: "alumni",
      networkingStatus: "checking_for_openings",
      nextAction: "Follow up about platform roles",
      followUpOn: asOfOn,
      methods: [{ kind: "email", value: "rahul@invalid.test", isPrimary: true }],
      now,
    });
    createContact(db, a, {
      id: "priya",
      companyId: microsoft.id,
      name: "Priya Nair",
      networkingStatus: "not_contacted",
      now,
    });

    const sde = createOpportunity(db, a, {
      id: "microsoft-sde",
      companyId: microsoft.id,
      role: "SDE",
      jobId: "182763",
      now,
    });

    const dueToday = getTodaySnapshot(db, a, { now });
    expect(dueToday.asOfOn).toBe(asOfOn);
    const rahulRow = dueToday.doNow.find((row) => row.entityId === rahul.id);
    expect(rahulRow).toBeDefined();
    expect(
      todayDoNowHeading(rahulRow!.sourceKey, rahulRow!.verb, rahulRow!.entityLabel),
    ).toBe("Follow up with Rahul Sharma");
    expect(dueToday.stats.interviewsToday).toBe(0);

    createInterview(db, a, {
      id: "round-1",
      opportunityId: sde.id,
      kind: "Coding",
      interviewer: "Rahul",
      dateOn: asOfOn,
      time: "11:00",
      now,
    });
    const withInterview = getTodaySnapshot(db, a, { now });
    expect(withInterview.stats.interviewsToday).toBe(1);
    expect(
      withInterview.doNow.some((row) => row.entityId === sde.id),
    ).toBe(true);

    const materialized = materializeNotifications(db, a, { now });
    expect(materialized.count).toBeGreaterThan(0);
    const followUp = listNotifications(db, a, "unread", { now }).find(
      (row) => row.entityId === rahul.id,
    );
    expect(followUp).toBeDefined();
    snoozeNotificationsByPreset(db, a, [followUp!.id], "1h", { now });
    expect(
      getTodaySnapshot(db, a, { now }).doNow.some(
        (row) => row.entityId === rahul.id,
      ),
    ).toBe(false);
    expect(getContact(db, a, rahul.id)?.followUpOn).toBe(asOfOn);

    createDocument(db, a, { id: "doc-backend", name: "Backend Java", now });
    const backendV3 = storeDocumentVersion(
      db,
      a,
      {
        id: "version-backend-3",
        documentId: "doc-backend",
        label: "v3",
        bytes: new Uint8Array([37, 80, 68, 70]),
        contentType: "application/pdf",
        now,
      },
      fixture.uploadsRoot,
    );
    expect(documentVersionLabel("Backend Java", backendV3.label)).toBe(
      "Backend Java v3",
    );
    applyToOpportunity(db, a, {
      opportunityId: sde.id,
      portal: "Careers",
      appliedOn: asOfOn,
      resumeVersionId: backendV3.id,
      now,
    });
    expect(getOpportunity(db, a, sde.id)?.application?.resumeVersionId).toBe(
      backendV3.id,
    );

    const filtered = listContacts(
      db,
      a,
      parseContactListFilter(
        new URLSearchParams({
          company: microsoft.id,
          status: "checking_for_openings",
        }),
      ),
    );
    expect(filtered.map((row) => row.name)).toEqual(["Rahul Sharma"]);

    try {
      createOpportunity(db, a, {
        id: "microsoft-sde-copy",
        companyId: microsoft.id,
        role: "SDE",
        jobId: "182763",
        now,
      });
      throw new Error("expected DuplicateConflictError");
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateConflictError);
      expect((error as DuplicateConflictError).message).toBe(
        DUPLICATE_JOB_WARNING,
      );
    }
    expect(listOpportunities(db, a, "all")).toHaveLength(1);

    const csv = buildWorkspaceExport(
      db,
      a,
      parseExportQuery(new URLSearchParams("format=csv&set=contacts")),
      now,
    );
    expect(csv.body).toContain("rahul@invalid.test");
    expect(csv.body).not.toContain("password");

    const saved = updateWorkspaceSettings(db, a, {
      displayName: "Yash Kumar Vaibhav",
      university: "IIIT Delhi",
      timezone: "Asia/Kolkata",
      quietStart: "23:30",
      quietEnd: "08:00",
      now,
    });
    expect(readWorkspaceSettings(db, a)).toEqual(
      expect.objectContaining({
        displayName: saved.displayName,
        university: "IIIT Delhi",
        timezone: "Asia/Kolkata",
      }),
    );

    expect(listCompanies(db, b)).toEqual([]);
    expect(listContacts(db, b)).toEqual([]);
    expect(listOpportunities(db, b, "all")).toEqual([]);
    expect(listApplications(db, b)).toEqual([]);
    expect(getContact(db, b, rahul.id)).toBeUndefined();
    expect(getOpportunity(db, b, sde.id)).toBeUndefined();
    expect(getDocumentVersion(db, b, backendV3.id)).toBeUndefined();
    const emptyExport = buildWorkspaceExport(
      db,
      b,
      parseExportQuery(new URLSearchParams("format=csv&set=contacts")),
      now,
    );
    expect(emptyExport.body).not.toContain("rahul@invalid.test");
    expect(getTodaySnapshot(db, b, { now }).doNow).toEqual([]);
    expect(getContact(db, a, rahul.id)?.name).toBe("Rahul Sharma");
    expect(listApplications(db, a)).toHaveLength(1);
  });
});

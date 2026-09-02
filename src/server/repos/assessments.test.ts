import { afterEach, describe, expect, it } from "vitest";

import { dueSourceKey } from "../../domain/due-source";
import { calendarDateInZone } from "../../domain/referral";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { listActivity } from "./activity";
import {
  applyToOpportunity,
  updateApplication,
} from "./applications";
import { createCompany } from "./companies";
import {
  AssessmentInputError,
  createAssessment,
  deleteAssessment,
  getAssessment,
  listAssessments,
  updateAssessment,
} from "./assessments";
import { createOpportunity, getOpportunity } from "./opportunities";
import {
  listNotifications,
  materializeNotifications,
} from "./notifications";
import { listDueItems } from "./tasks";
import { getTodaySnapshot } from "./today";

describe("assessment repository", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  function seedOpportunity(
    fixture: ReturnType<typeof createTenantTestFixture>,
    tenant: "tenantA" | "tenantB",
    ids: { companyId: string; opportunityId: string; role: string },
  ) {
    const owner = fixture[tenant];
    createCompany(fixture.client.db, owner, {
      id: ids.companyId,
      name: tenant === "tenantA" ? "Google" : "Private Co",
    });
    return createOpportunity(fixture.client.db, owner, {
      id: ids.opportunityId,
      companyId: ids.companyId,
      role: ids.role,
    });
  }

  const now = new Date("2026-09-02T02:00:00.000Z");

  it("makes an in-horizon deadline a due item, drops a completed one, and keeps an expired one overdue", () => {
    const fixture = newFixture();
    seedOpportunity(fixture, "tenantA", {
      companyId: "google",
      opportunityId: "google-swe",
      role: "SDE",
    });

    const upcoming = createAssessment(fixture.client.db, fixture.tenantA, {
      id: "oa-tomorrow",
      opportunityId: "google-swe",
      kind: "Online Assessment",
      platform: "HackerRank",
      dateOn: "2026-09-03",
      time: "18:00",
      now,
    });
    const expired = createAssessment(fixture.client.db, fixture.tenantA, {
      id: "oa-expired",
      opportunityId: "google-swe",
      kind: "Online Assessment",
      dateOn: "2026-09-01",
      time: "18:00",
      now,
    });
    createAssessment(fixture.client.db, fixture.tenantA, {
      id: "oa-done",
      opportunityId: "google-swe",
      kind: "Online Assessment",
      dateOn: "2026-09-03",
      time: "18:00",
      now,
    });
    updateAssessment(fixture.client.db, fixture.tenantA, "oa-done", {
      status: "completed",
      now,
    });

    expect(upcoming).toMatchObject({
      kind: "Online Assessment",
      platform: "HackerRank",
      dueOn: "2026-09-03",
      status: "invited",
      companyName: "Google",
      applicationId: null,
    });
    expect(expired?.dueOn).toBe("2026-09-01");

    const keys = listDueItems(fixture.client.db, fixture.tenantA).map(
      (row) => row.sourceKey,
    );
    expect(keys).toContain(dueSourceKey("assessment_deadline", "oa-tomorrow"));
    expect(keys).toContain(dueSourceKey("assessment_deadline", "oa-expired"));
    expect(keys).not.toContain(dueSourceKey("assessment_deadline", "oa-done"));

    const snapshot = getTodaySnapshot(fixture.client.db, fixture.tenantA, {
      now,
    });
    expect(snapshot.asOfOn).toBe("2026-09-02");
    expect(snapshot.pipeline.oa).toBe(0);
    expect(snapshot.stats.deadlines).toBe(2);
    expect(snapshot.stats.followUps).toBe(0);
    expect(snapshot.doNow.map((row) => row.sourceKey).sort()).toEqual([
      dueSourceKey("assessment_deadline", "oa-expired"),
      dueSourceKey("assessment_deadline", "oa-tomorrow"),
    ]);
    expect(
      snapshot.doNow.find(
        (row) => row.sourceKey === dueSourceKey("assessment_deadline", "oa-tomorrow"),
      ),
    ).toMatchObject({
      title: "Complete Google assessment",
      dueOn: "2026-09-03",
      entityLabel: "Google",
    });

    materializeNotifications(fixture.client.db, fixture.tenantA, { now });
    const overdue = listNotifications(fixture.client.db, fixture.tenantA, "overdue", {
      now,
    });
    expect(
      overdue.map((row) => row.dueKey),
    ).toContain(dueSourceKey("assessment_deadline", "oa-expired"));
  });

  it("allows a recruiter-sourced assessment before an application and keeps the opportunity when deleted", () => {
    const fixture = newFixture();
    seedOpportunity(fixture, "tenantA", {
      companyId: "google",
      opportunityId: "google-swe",
      role: "SDE",
    });
    const created = createAssessment(fixture.client.db, fixture.tenantA, {
      id: "oa-recruiter",
      opportunityId: "google-swe",
      kind: "Online Assessment",
      now,
    });
    expect(created?.applicationId).toBeNull();
    expect(
      listAssessments(fixture.client.db, fixture.tenantA, "google-swe"),
    ).toHaveLength(1);

    expect(
      deleteAssessment(fixture.client.db, fixture.tenantA, "oa-recruiter"),
    ).toBe(true);
    expect(getAssessment(fixture.client.db, fixture.tenantA, "oa-recruiter")).toBeUndefined();
    expect(getOpportunity(fixture.client.db, fixture.tenantA, "google-swe")?.role).toBe(
      "SDE",
    );
    expect(fixture.rowCount("assessment")).toBe(0);
  });

  it("scopes rows to one workspace and uses that workspace timezone for due dates", () => {
    const fixture = newFixture();
    seedOpportunity(fixture, "tenantA", {
      companyId: "google",
      opportunityId: "google-swe",
      role: "SDE",
    });
    seedOpportunity(fixture, "tenantB", {
      companyId: "private-co",
      opportunityId: "hidden-sde",
      role: "SDE",
    });

    expect(calendarDateInZone("Asia/Kolkata", now)).toBe("2026-09-02");
    expect(calendarDateInZone("America/New_York", now)).toBe("2026-09-01");

    const at = new Date("2026-09-02T06:00:00.000Z");
    createAssessment(fixture.client.db, fixture.tenantA, {
      id: "a-oa",
      opportunityId: "google-swe",
      kind: "Online Assessment",
      dueAt: at,
      now,
    });
    createAssessment(fixture.client.db, fixture.tenantB, {
      id: "b-oa",
      opportunityId: "hidden-sde",
      kind: "Online Assessment",
      dueAt: at,
      now,
    });

    expect(
      createAssessment(fixture.client.db, fixture.tenantB, {
        opportunityId: "google-swe",
        kind: "Injected",
      }),
    ).toBeUndefined();
    expect(getAssessment(fixture.client.db, fixture.tenantB, "a-oa")).toBeUndefined();
    expect(deleteAssessment(fixture.client.db, fixture.tenantB, "a-oa")).toBe(
      false,
    );
    expect(listAssessments(fixture.client.db, fixture.tenantB, "google-swe")).toEqual(
      [],
    );

    const a = getTodaySnapshot(fixture.client.db, fixture.tenantA, { now });
    const b = getTodaySnapshot(fixture.client.db, fixture.tenantB, { now });
    expect(a.doNow.map((row) => row.sourceKey)).toContain(
      dueSourceKey("assessment_deadline", "a-oa"),
    );
    expect(a.doNow.map((row) => row.sourceKey)).not.toContain(
      dueSourceKey("assessment_deadline", "b-oa"),
    );
    expect(b.doNow.map((row) => row.sourceKey)).toContain(
      dueSourceKey("assessment_deadline", "b-oa"),
    );
    expect(b.doNow.map((row) => row.sourceKey)).not.toContain(
      dueSourceKey("assessment_deadline", "a-oa"),
    );
    expect(
      listDueItems(fixture.client.db, fixture.tenantA).some((row) =>
        row.entityLabel.includes("Private"),
      ),
    ).toBe(false);
  });

  it("refuses a foreign application link and cascades when the opportunity is deleted", () => {
    const fixture = newFixture();
    seedOpportunity(fixture, "tenantA", {
      companyId: "google",
      opportunityId: "google-swe",
      role: "SDE",
    });
    seedOpportunity(fixture, "tenantB", {
      companyId: "private-co",
      opportunityId: "hidden-sde",
      role: "SDE",
    });
    const ownedApp = applyToOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-app",
      opportunityId: "google-swe",
      portal: "Greenhouse",
      appliedOn: "2026-09-01",
    });
    const foreignApp = applyToOpportunity(fixture.client.db, fixture.tenantB, {
      id: "hidden-app",
      opportunityId: "hidden-sde",
      portal: "Hidden",
      appliedOn: "2026-09-01",
    });
    expect(ownedApp).toBeDefined();
    expect(foreignApp).toBeDefined();

    expect(() =>
      createAssessment(fixture.client.db, fixture.tenantA, {
        opportunityId: "google-swe",
        applicationId: "hidden-app",
        kind: "Online Assessment",
      }),
    ).toThrow(AssessmentInputError);

    const linked = createAssessment(fixture.client.db, fixture.tenantA, {
      id: "oa-linked",
      opportunityId: "google-swe",
      applicationId: "google-app",
      kind: "Online Assessment",
      now,
    });
    expect(linked?.applicationId).toBe("google-app");

    expect(() =>
      createAssessment(fixture.client.db, fixture.tenantA, {
        opportunityId: "google-swe",
        kind: "  ",
      }),
    ).toThrow(AssessmentInputError);

    fixture.client.sqlite
      .prepare("delete from opportunity where id = ? and workspace_id = ?")
      .run("google-swe", fixture.tenantA.workspaceId);
    expect(fixture.rowCount("assessment")).toBe(0);
  });

  it("logs invited and completed events and surfaces an overdue offer deadline", () => {
    const fixture = newFixture();
    seedOpportunity(fixture, "tenantA", {
      companyId: "google",
      opportunityId: "google-swe",
      role: "SDE",
    });
    applyToOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-app",
      opportunityId: "google-swe",
      portal: "Greenhouse",
      appliedOn: "2026-09-01",
    });
    createAssessment(fixture.client.db, fixture.tenantA, {
      id: "oa-google",
      opportunityId: "google-swe",
      kind: "Online Assessment",
      dateOn: "2026-09-03",
      time: "18:00",
      now,
    });
    updateAssessment(fixture.client.db, fixture.tenantA, "oa-google", {
      status: "completed",
      now,
    });
    updateApplication(fixture.client.db, fixture.tenantA, "google-app", {
      offerDeadlineOn: "2026-09-01",
    });

    const kinds = listActivity(fixture.client.db, fixture.tenantA, {
      timeZone: "Asia/Kolkata",
    }).map((row) => row.kind);
    expect(kinds).toContain("ASSESSMENT_INVITED");
    expect(kinds).toContain("ASSESSMENT_COMPLETED");
    expect(kinds).toContain("OFFER_DEADLINE_SET");

    const snapshot = getTodaySnapshot(fixture.client.db, fixture.tenantA, {
      now,
    });
    expect(snapshot.pipeline.oa).toBe(0);
    expect(
      snapshot.doNow.map((row) => row.sourceKey),
    ).toContain(dueSourceKey("offer_deadline", "google-app"));
    expect(
      snapshot.doNow.find(
        (row) => row.sourceKey === dueSourceKey("offer_deadline", "google-app"),
      ),
    ).toMatchObject({
      dueOn: "2026-09-01",
      title: "Offer deadline",
    });
    expect(snapshot.stats.deadlines).toBeGreaterThanOrEqual(1);

    materializeNotifications(fixture.client.db, fixture.tenantA, { now });
    const overdue = listNotifications(
      fixture.client.db,
      fixture.tenantA,
      "overdue",
      { now },
    );
    expect(overdue.map((row) => row.dueKey)).toContain(
      dueSourceKey("offer_deadline", "google-app"),
    );

    updateApplication(fixture.client.db, fixture.tenantA, "google-app", {
      offerDecision: "accepted",
    });
    expect(
      listDueItems(fixture.client.db, fixture.tenantA).map((row) => row.sourceKey),
    ).not.toContain(dueSourceKey("offer_deadline", "google-app"));
  });
});

import { afterEach, describe, expect, it } from "vitest";

import { dueSourceKey } from "../../domain/due-source";
import { calendarDateInZone } from "../../domain/referral";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createCompany } from "./companies";
import {
  InterviewInputError,
  createInterview,
  deleteInterview,
  getInterview,
  listInterviews,
  updateInterview,
} from "./interviews";
import { createOpportunity, getOpportunity } from "./opportunities";
import { listDueItems } from "./tasks";
import { getTodaySnapshot } from "./today";

describe("interview repository", () => {
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
      name: tenant === "tenantA" ? "Microsoft" : "Private Co",
    });
    return createOpportunity(fixture.client.db, owner, {
      id: ids.opportunityId,
      companyId: ids.companyId,
      role: ids.role,
    });
  }

  it("stores rounds in order and keeps the opportunity when a round is deleted", () => {
    const fixture = newFixture();
    seedOpportunity(fixture, "tenantA", {
      companyId: "microsoft",
      opportunityId: "ms-sde",
      role: "SDE",
    });

    const first = createInterview(fixture.client.db, fixture.tenantA, {
      id: "round-1",
      opportunityId: "ms-sde",
      kind: "Coding",
      interviewer: "Rahul",
      dateOn: "2026-09-02",
      time: "11:00",
      now: new Date("2026-09-02T02:00:00.000Z"),
    });
    const pending = createInterview(fixture.client.db, fixture.tenantA, {
      id: "round-3",
      opportunityId: "ms-sde",
      kind: "Hiring Manager",
    });
    const second = createInterview(fixture.client.db, fixture.tenantA, {
      id: "round-2",
      opportunityId: "ms-sde",
      kind: "LLD",
      dateOn: "2026-09-06",
      time: "15:00",
    });

    expect(first).toMatchObject({
      roundIndex: 1,
      kind: "Coding",
      interviewer: "Rahul",
      dueOn: "2026-09-02",
      whenLabel: "2026-09-02 · 11:00",
      companyName: "Microsoft",
      role: "SDE",
    });
    expect(pending).toMatchObject({
      roundIndex: 2,
      kind: "Hiring Manager",
      at: null,
      dueOn: null,
      whenLabel: "Pending",
    });
    expect(second).toMatchObject({ roundIndex: 3, kind: "LLD" });
    expect(
      listInterviews(fixture.client.db, fixture.tenantA, "ms-sde").map(
        (row) => row.id,
      ),
    ).toEqual(["round-1", "round-3", "round-2"]);

    expect(deleteInterview(fixture.client.db, fixture.tenantA, "round-3")).toBe(
      true,
    );
    expect(getInterview(fixture.client.db, fixture.tenantA, "round-3")).toBeUndefined();
    expect(getOpportunity(fixture.client.db, fixture.tenantA, "ms-sde")?.role).toBe(
      "SDE",
    );
    expect(listInterviews(fixture.client.db, fixture.tenantA, "ms-sde")).toHaveLength(
      2,
    );
    expect(fixture.rowCount("interview")).toBe(2);
  });

  it("persists result and notes, and a pending round is not due today", () => {
    const fixture = newFixture();
    seedOpportunity(fixture, "tenantA", {
      companyId: "microsoft",
      opportunityId: "ms-sde",
      role: "SDE",
    });
    createInterview(fixture.client.db, fixture.tenantA, {
      id: "pending",
      opportunityId: "ms-sde",
      kind: "Hiring Manager",
    });
    createInterview(fixture.client.db, fixture.tenantA, {
      id: "round-1",
      opportunityId: "ms-sde",
      kind: "Coding",
      dateOn: "2026-09-02",
      time: "11:00",
    });

    const updated = updateInterview(fixture.client.db, fixture.tenantA, "round-1", {
      result: "Passed",
      notes: "Clean graph solution.",
    });
    expect(updated).toMatchObject({
      result: "Passed",
      notes: "Clean graph solution.",
    });
    expect(getInterview(fixture.client.db, fixture.tenantA, "round-1")).toMatchObject({
      result: "Passed",
      notes: "Clean graph solution.",
    });

    const now = new Date("2026-09-02T02:00:00.000Z");
    const snapshot = getTodaySnapshot(fixture.client.db, fixture.tenantA, {
      now,
    });
    expect(snapshot.stats.interviewsToday).toBe(1);
    expect(
      snapshot.doNow.some(
        (row) => row.sourceKey === dueSourceKey("interview", "pending"),
      ),
    ).toBe(false);
    expect(
      snapshot.doNow.some(
        (row) => row.sourceKey === dueSourceKey("interview", "round-1"),
      ),
    ).toBe(false);
  });

  it("scopes rounds to one workspace and uses that workspace timezone for today", () => {
    const fixture = newFixture();
    seedOpportunity(fixture, "tenantA", {
      companyId: "microsoft",
      opportunityId: "ms-sde",
      role: "SDE",
    });
    seedOpportunity(fixture, "tenantB", {
      companyId: "private-co",
      opportunityId: "hidden-sde",
      role: "SDE",
    });

    const now = new Date("2026-09-02T02:00:00.000Z");
    expect(calendarDateInZone("Asia/Kolkata", now)).toBe("2026-09-02");
    expect(calendarDateInZone("America/New_York", now)).toBe("2026-09-01");

    const at = new Date("2026-09-02T06:00:00.000Z");
    createInterview(fixture.client.db, fixture.tenantA, {
      id: "a-round",
      opportunityId: "ms-sde",
      kind: "Coding",
      at,
    });
    createInterview(fixture.client.db, fixture.tenantB, {
      id: "b-round",
      opportunityId: "hidden-sde",
      kind: "Coding",
      at,
    });

    expect(
      createInterview(fixture.client.db, fixture.tenantB, {
        opportunityId: "ms-sde",
        kind: "Injected",
      }),
    ).toBeUndefined();
    expect(getInterview(fixture.client.db, fixture.tenantB, "a-round")).toBeUndefined();
    expect(deleteInterview(fixture.client.db, fixture.tenantB, "a-round")).toBe(
      false,
    );
    expect(listInterviews(fixture.client.db, fixture.tenantB, "ms-sde")).toEqual(
      [],
    );

    const a = getTodaySnapshot(fixture.client.db, fixture.tenantA, { now });
    const b = getTodaySnapshot(fixture.client.db, fixture.tenantB, { now });
    expect(a.stats.interviewsToday).toBe(1);
    expect(b.stats.interviewsToday).toBe(0);
    expect(a.doNow.map((row) => row.sourceKey)).toContain(
      dueSourceKey("interview", "a-round"),
    );
    expect(b.doNow.map((row) => row.sourceKey)).not.toContain(
      dueSourceKey("interview", "b-round"),
    );
    expect(listDueItems(fixture.client.db, fixture.tenantA).some((row) => row.entityLabel.includes("Private"))).toBe(
      false,
    );
  });

  it("deleting the opportunity cascades rounds and a blank kind is refused", () => {
    const fixture = newFixture();
    seedOpportunity(fixture, "tenantA", {
      companyId: "microsoft",
      opportunityId: "ms-sde",
      role: "SDE",
    });
    createInterview(fixture.client.db, fixture.tenantA, {
      id: "round-1",
      opportunityId: "ms-sde",
      kind: "Coding",
    });
    expect(() =>
      createInterview(fixture.client.db, fixture.tenantA, {
        opportunityId: "ms-sde",
        kind: "  ",
      }),
    ).toThrow(InterviewInputError);

    fixture.client.sqlite
      .prepare("delete from opportunity where id = ? and workspace_id = ?")
      .run("ms-sde", fixture.tenantA.workspaceId);
    expect(fixture.rowCount("interview")).toBe(0);
  });
});

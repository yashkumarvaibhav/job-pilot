import { afterEach, describe, expect, it } from "vitest";

import { dueSourceKey } from "../../domain/due-source";
import {
  calendarDateInZone,
  shiftCalendarDate,
} from "../../domain/referral";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createCompany } from "./companies";
import { createContact, getContact, updateContact } from "./contacts";
import { createInteraction } from "./interactions";
import { createOpportunity } from "./opportunities";
import { createReferral, updateReferral } from "./referrals";
import {
  completeDerivedDueItem,
  createTask,
  createTaskFromDerived,
  listDueItems,
} from "./tasks";
import { getTodaySnapshot, listTodayDueItems } from "./today";

describe("follow-up engine", () => {
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

  const now = new Date("2026-09-02T02:00:00.000Z");

  it("puts a contact follow-up date on Today without a next-action string", () => {
    const fixture = newFixture();
    const asOfOn = calendarDateInZone("Asia/Kolkata", now);
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      name: "Priya Nair",
      networkingStatus: "waiting_for_reply",
      followUpOn: asOfOn,
    });

    const snapshot = getTodaySnapshot(fixture.client.db, fixture.tenantA, {
      now,
    });
    expect(snapshot.doNow).toEqual([
      expect.objectContaining({
        sourceKey: dueSourceKey("contact_next_action", "priya"),
        origin: "derived",
        title: "Follow up",
        entityLabel: "Priya Nair",
        dueOn: asOfOn,
      }),
    ]);
    expect(snapshot.stats.followUps).toBe(1);
    expect(snapshot.stats.needReply).toBe(0);
  });

  it("drops Do Not Contact and Inactive even when their follow-up date is today", () => {
    const fixture = newFixture();
    const asOfOn = calendarDateInZone("Asia/Kolkata", now);
    createContact(fixture.client.db, fixture.tenantA, {
      id: "blocked",
      name: "Do Not Contact Person",
      networkingStatus: "do_not_contact",
      nextAction: "Follow up",
      followUpOn: asOfOn,
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "quiet",
      name: "Inactive Person",
      networkingStatus: "inactive",
      nextAction: "Follow up",
      followUpOn: asOfOn,
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      name: "Priya Nair",
      networkingStatus: "waiting_for_reply",
      followUpOn: asOfOn,
    });

    const keys = listTodayDueItems(
      fixture.client.db,
      fixture.tenantA,
      asOfOn,
    ).map((item) => item.sourceKey);
    expect(keys).toEqual([dueSourceKey("contact_next_action", "priya")]);
  });

  it("lists a promised-not-received referral that is due today", () => {
    const fixture = newFixture();
    const asOfOn = calendarDateInZone("Asia/Kolkata", now);
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "uber",
      name: "Uber",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "ankit",
      name: "Ankit",
      companyId: "uber",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "uber-sde",
      companyId: "uber",
      role: "SDE",
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "referral-ankit",
      contactId: "ankit",
      opportunityId: "uber-sde",
      channel: "whatsapp",
      stage: "referral_promised",
      followUpOn: asOfOn,
    });
    updateReferral(fixture.client.db, fixture.tenantA, "referral-ankit", {
      stage: "declined",
      followUpOn: asOfOn,
      nextAction: "Should not appear",
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "referral-live",
      contactId: "ankit",
      opportunityId: "uber-sde",
      channel: "whatsapp",
      stage: "referral_promised",
      followUpOn: asOfOn,
    });

    const snapshot = getTodaySnapshot(fixture.client.db, fixture.tenantA, {
      now,
    });
    expect(
      snapshot.doNow.filter((row) => row.entityType === "referral"),
    ).toEqual([
      expect.objectContaining({
        sourceKey: dueSourceKey("referral_follow_up", "referral-live"),
        title: "Check referral",
        entityLabel: "Ankit",
        dueOn: asOfOn,
      }),
    ]);
  });

  it("counts Need reply only from unresolved inbound Needs my reply", () => {
    const fixture = newFixture();
    const asOfOn = calendarDateInZone("Asia/Kolkata", now);
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      name: "Priya Nair",
      networkingStatus: "waiting_for_reply",
      followUpOn: asOfOn,
    });
    createInteraction(fixture.client.db, fixture.tenantA, {
      contactId: "priya",
      channel: "email",
      direction: "outbound",
      body: "Asked about openings",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
    });
    createInteraction(fixture.client.db, fixture.tenantA, {
      contactId: "rahul",
      channel: "email",
      direction: "inbound",
      requiresReply: true,
      body: "Can you share a resume?",
    });

    const snapshot = getTodaySnapshot(fixture.client.db, fixture.tenantA, {
      now,
    });
    expect(snapshot.stats.needReply).toBe(1);
    expect(
      snapshot.doNow.some((row) => row.entityLabel === "Priya Nair"),
    ).toBe(true);
  });

  it("removes a follow-up from Do Now when the date moves to tomorrow", () => {
    const fixture = newFixture();
    const asOfOn = calendarDateInZone("Asia/Kolkata", now);
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      name: "Priya Nair",
      networkingStatus: "waiting_for_reply",
      followUpOn: asOfOn,
    });
    expect(
      getTodaySnapshot(fixture.client.db, fixture.tenantA, { now }).doNow,
    ).toHaveLength(1);

    updateContact(fixture.client.db, fixture.tenantA, "priya", {
      followUpOn: shiftCalendarDate(asOfOn, 1),
    });
    expect(
      getTodaySnapshot(fixture.client.db, fixture.tenantA, { now }).doNow,
    ).toEqual([]);
  });

  it("completes a contact follow-up once without creating a task or touching another workspace", () => {
    const fixture = newFixture();
    const asOfOn = calendarDateInZone("Asia/Kolkata", now);
    const sourceKey = dueSourceKey("contact_next_action", "priya");
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      name: "Priya Nair",
      networkingStatus: "waiting_for_reply",
      nextAction: "Ask about referrals",
      followUpOn: asOfOn,
    });
    createContact(fixture.client.db, fixture.tenantB, {
      id: "b-priya",
      name: "Private Priya",
      networkingStatus: "waiting_for_reply",
      nextAction: "Private follow-up",
      followUpOn: asOfOn,
    });

    const beforeEvents = fixture.rowCount("activity_event");
    expect(
      completeDerivedDueItem(fixture.client.db, fixture.tenantA, {
        sourceKey,
        now,
      }),
    ).toEqual({ outcome: "completed" });
    expect(
      completeDerivedDueItem(fixture.client.db, fixture.tenantA, {
        sourceKey,
        now: new Date(now.valueOf() + 1_000),
      }),
    ).toEqual({ outcome: "already_completed" });

    expect(getContact(fixture.client.db, fixture.tenantA, "priya")).toMatchObject({
      nextAction: null,
      followUpOn: null,
    });
    expect(getContact(fixture.client.db, fixture.tenantB, "b-priya")).toMatchObject({
      nextAction: "Private follow-up",
      followUpOn: asOfOn,
    });
    expect(
      getTodaySnapshot(fixture.client.db, fixture.tenantA, { now }).doNow,
    ).toEqual([]);
    expect(
      fixture.client.sqlite
        .prepare("select count(*) as count from task where workspace_id = ?")
        .get(fixture.tenantA.workspaceId),
    ).toEqual({ count: 0 });
    expect(fixture.rowCount("activity_event")).toBe(beforeEvents + 1);
    expect(
      fixture.client.sqlite
        .prepare(
          "select kind, entity_type as entityType, entity_id as entityId from activity_event where workspace_id = ? and kind = 'FOLLOW_UP_COMPLETED'",
        )
        .get(fixture.tenantA.workspaceId),
    ).toEqual({
      kind: "FOLLOW_UP_COMPLETED",
      entityType: "contact",
      entityId: "priya",
    });
  });

  it("treats a foreign contact follow-up source as missing without writing activity", () => {
    const fixture = newFixture();
    createContact(fixture.client.db, fixture.tenantB, {
      id: "private-priya",
      name: "Private Priya",
      followUpOn: calendarDateInZone("America/New_York", now),
    });
    const beforeEvents = fixture.rowCount("activity_event");

    expect(
      completeDerivedDueItem(fixture.client.db, fixture.tenantA, {
        sourceKey: dueSourceKey("contact_next_action", "private-priya"),
        now,
      }),
    ).toBeUndefined();
    expect(fixture.rowCount("activity_event")).toBe(beforeEvents);
  });

  it("keeps Do Now count the same after Create task and leaves a manual task visible", () => {
    const fixture = newFixture();
    const asOfOn = calendarDateInZone("Asia/Kolkata", now);
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      name: "Priya Nair",
      networkingStatus: "waiting_for_reply",
      followUpOn: asOfOn,
    });
    createTask(fixture.client.db, fixture.tenantA, {
      id: "task-resume",
      title: "Send resume",
      dueOn: asOfOn,
      entityType: "contact",
      entityId: "priya",
    });

    const before = getTodaySnapshot(fixture.client.db, fixture.tenantA, {
      now,
    });
    expect(before.doNow).toHaveLength(2);
    expect(before.stats.followUps).toBe(1);

    createTaskFromDerived(fixture.client.db, fixture.tenantA, {
      sourceKey: dueSourceKey("contact_next_action", "priya"),
      id: "task-from-priya",
    });

    const after = getTodaySnapshot(fixture.client.db, fixture.tenantA, {
      now,
    });
    expect(after.doNow).toHaveLength(before.doNow.length);
    expect(after.stats.followUps).toBe(0);
    expect(
      after.doNow.map((row) => ({
        origin: row.origin,
        title: row.title,
      })),
    ).toEqual(
      expect.arrayContaining([
        { origin: "task", title: "Follow up" },
        { origin: "task", title: "Send resume" },
      ]),
    );
  });

  it("does not pair workspace A's source key with workspace B's follow-up", () => {
    const fixture = newFixture();
    const asOfA = calendarDateInZone("Asia/Kolkata", now);
    const asOfB = calendarDateInZone("America/New_York", now);
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      name: "Priya Nair",
      networkingStatus: "waiting_for_reply",
      followUpOn: asOfA,
    });
    createContact(fixture.client.db, fixture.tenantB, {
      id: "b-priya",
      name: "Hidden Priya",
      networkingStatus: "waiting_for_reply",
      followUpOn: asOfB,
    });
    createTask(fixture.client.db, fixture.tenantA, {
      id: "task-a",
      title: "A only",
      dueOn: asOfA,
    });

    const converted = createTaskFromDerived(
      fixture.client.db,
      fixture.tenantA,
      {
        sourceKey: dueSourceKey("contact_next_action", "priya"),
        id: "task-from-a",
      },
    );
    expect(converted?.workspaceId).toBe(fixture.tenantA.workspaceId);

    const a = getTodaySnapshot(fixture.client.db, fixture.tenantA, { now });
    const b = getTodaySnapshot(fixture.client.db, fixture.tenantB, { now });
    expect(a.asOfOn).toBe(asOfA);
    expect(b.asOfOn).toBe(asOfB);
    expect(a.doNow.map((row) => row.entityLabel).sort()).toEqual([
      "A only",
      "Priya Nair",
    ]);
    expect(b.doNow).toEqual([
      expect.objectContaining({
        origin: "derived",
        entityLabel: "Hidden Priya",
        sourceKey: dueSourceKey("contact_next_action", "b-priya"),
      }),
    ]);
    expect(
      listDueItems(fixture.client.db, fixture.tenantB).some(
        (item) => item.taskId === "task-from-a",
      ),
    ).toBe(false);
    expect(
      createTaskFromDerived(fixture.client.db, fixture.tenantB, {
        sourceKey: dueSourceKey("contact_next_action", "priya"),
      }),
    ).toBeUndefined();
    expect(
      createTaskFromDerived(fixture.client.db, fixture.tenantB, {
        sourceKey: dueSourceKey("contact_next_action", "b-priya"),
      })?.id,
    ).not.toBe("task-from-a");
  });
});

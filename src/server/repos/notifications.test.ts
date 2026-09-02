import { afterEach, describe, expect, it } from "vitest";

import { dueSourceKey } from "../../domain/due-source";
import { calendarDateInZone } from "../../domain/referral";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createCompany } from "./companies";
import { createContact, getContact } from "./contacts";
import { createOpportunity, getOpportunity } from "./opportunities";
import {
  completeNotifications,
  countUnreadNotifications,
  dismissNotifications,
  listMutedNotificationKinds,
  listNotifications,
  materializeNotifications,
  muteNotificationKind,
  snoozeNotifications,
  snoozeNotificationsByPreset,
} from "./notifications";
import { createTask, createTaskFromDerived, getTask } from "./tasks";
import { getTodaySnapshot } from "./today";

describe("notification centre", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  const now = new Date("2026-09-02T08:30:00.000Z");

  it("upserts one row per stable source even when materialised twice", () => {
    const fixture = newFixture();
    const asOfOn = calendarDateInZone("Asia/Kolkata", now);
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      networkingStatus: "waiting_for_reply",
      nextAction: "Ask about openings",
      followUpOn: asOfOn,
    });

    const first = materializeNotifications(fixture.client.db, fixture.tenantA, {
      now,
    });
    const second = materializeNotifications(fixture.client.db, fixture.tenantA, {
      now,
    });
    expect(first.count).toBe(1);
    expect(second.count).toBe(1);
    expect(second.ids).toEqual(first.ids);
    expect(fixture.rowCount("notification")).toBe(1);
    const unread = listNotifications(
      fixture.client.db,
      fixture.tenantA,
      "unread",
      { now },
    );
    expect(unread).toEqual([
      expect.objectContaining({
        dueKey: dueSourceKey("contact_next_action", "rahul"),
        title: "Follow up with Rahul Sharma",
        body: "Ask about openings",
      }),
    ]);
  });

  it("groups deadline, next action, and a derived task, not a coincidental manual task", () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "atlassian",
      name: "Atlassian",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "atlassian-sde",
      companyId: "atlassian",
      role: "SDE",
      deadlineOn: "2026-09-03",
      nextAction: "Submit application",
      nextActionDue: "2026-09-03",
    });
    materializeNotifications(fixture.client.db, fixture.tenantA, { now });
    createTaskFromDerived(fixture.client.db, fixture.tenantA, {
      id: "task-apply",
      sourceKey: dueSourceKey("opportunity_next_action", "atlassian-sde"),
    });
    createTask(fixture.client.db, fixture.tenantA, {
      id: "task-notes",
      title: "Read hiring blog",
      dueOn: "2026-09-03",
      entityType: "opportunity",
      entityId: "atlassian-sde",
    });
    materializeNotifications(fixture.client.db, fixture.tenantA, { now });
    const all = listNotifications(fixture.client.db, fixture.tenantA, "all", {
      now,
    });
    const applyGroup = all.filter(
      (row) => row.groupKey === "opportunity:atlassian-sde:apply",
    );
    const manual = all.filter(
      (row) => row.dueKey === dueSourceKey("task", "task-notes"),
    );
    expect(applyGroup.map((row) => row.dueKey).sort()).toEqual([
      dueSourceKey("opportunity_deadline", "atlassian-sde"),
      dueSourceKey("opportunity_next_action", "atlassian-sde"),
      dueSourceKey("task", "task-apply"),
    ]);
    expect(manual).toEqual([
      expect.objectContaining({
        groupKey: null,
        title: "Read hiring blog",
      }),
    ]);
  });

  it("snoozes only snoozed_until and restores the Today row when the clock passes", () => {
    const fixture = newFixture();
    const asOfOn = calendarDateInZone("Asia/Kolkata", now);
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      networkingStatus: "waiting_for_reply",
      followUpOn: asOfOn,
    });
    materializeNotifications(fixture.client.db, fixture.tenantA, { now });
    const [row] = listNotifications(
      fixture.client.db,
      fixture.tenantA,
      "unread",
      { now },
    );
    const before = getContact(fixture.client.db, fixture.tenantA, "rahul");
    const until = new Date("2026-09-02T11:30:00.000Z");
    snoozeNotifications(fixture.client.db, fixture.tenantA, [row.id], until, now);

    expect(
      getTodaySnapshot(fixture.client.db, fixture.tenantA, { now }).doNow,
    ).toEqual([]);
    expect(
      listNotifications(fixture.client.db, fixture.tenantA, "unread", { now }),
    ).toEqual([]);
    const after = getContact(fixture.client.db, fixture.tenantA, "rahul");
    expect(after?.followUpOn).toBe(before?.followUpOn);
    expect(after?.followUpOn).toBe(asOfOn);
    expect(after?.networkingStatus).toBe("waiting_for_reply");

    const later = new Date("2026-09-02T11:31:00.000Z");
    expect(
      getTodaySnapshot(fixture.client.db, fixture.tenantA, { now: later })
        .doNow,
    ).toEqual([
      expect.objectContaining({
        sourceKey: dueSourceKey("contact_next_action", "rahul"),
        entityLabel: "Rahul Sharma",
      }),
    ]);
    expect(
      listNotifications(fixture.client.db, fixture.tenantA, "unread", {
        now: later,
      }),
    ).toHaveLength(1);
  });

  it("writes mute as a settings flag so a new event of that type lands in Muted", () => {
    const fixture = newFixture();
    const asOfOn = calendarDateInZone("Asia/Kolkata", now);
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      followUpOn: asOfOn,
    });
    materializeNotifications(fixture.client.db, fixture.tenantA, { now });
    muteNotificationKind(fixture.client.db, fixture.tenantA, "contact_next_action");
    expect(listMutedNotificationKinds(fixture.client.db, fixture.tenantA)).toEqual(
      ["contact_next_action"],
    );
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      name: "Priya Nair",
      followUpOn: asOfOn,
    });
    materializeNotifications(fixture.client.db, fixture.tenantA, { now });
    expect(
      listNotifications(fixture.client.db, fixture.tenantA, "unread", { now }),
    ).toEqual([]);
    expect(
      listNotifications(fixture.client.db, fixture.tenantA, "muted", { now }).map(
        (row) => row.entityId,
      ),
    ).toEqual(expect.arrayContaining(["rahul", "priya"]));
  });

  it("keeps workspace A from observing or snoozing workspace B", () => {
    const fixture = newFixture();
    const asOfOnA = calendarDateInZone("Asia/Kolkata", now);
    const asOfOnB = calendarDateInZone("America/New_York", now);
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul-a",
      name: "Rahul Sharma",
      followUpOn: asOfOnA,
    });
    createContact(fixture.client.db, fixture.tenantB, {
      id: "rahul-b",
      name: "Rahul Sharma",
      followUpOn: asOfOnB,
    });
    materializeNotifications(fixture.client.db, fixture.tenantA, { now });
    materializeNotifications(fixture.client.db, fixture.tenantB, { now });

    const fromA = listNotifications(fixture.client.db, fixture.tenantA, "all", {
      now,
    });
    const fromB = listNotifications(fixture.client.db, fixture.tenantB, "all", {
      now,
    });
    expect(fromA).toHaveLength(1);
    expect(fromB).toHaveLength(1);
    expect(fromA[0]?.dueKey).toBe(dueSourceKey("contact_next_action", "rahul-a"));
    expect(fromB[0]?.dueKey).toBe(dueSourceKey("contact_next_action", "rahul-b"));
    expect(JSON.stringify(fromA)).not.toContain("rahul-b");
    expect(JSON.stringify(fromB)).not.toContain("rahul-a");

    expect(
      snoozeNotificationsByPreset(
        fixture.client.db,
        fixture.tenantA,
        [fromB[0]!.id],
        "3h",
        { now },
      ),
    ).toEqual([]);
    expect(
      getContact(fixture.client.db, fixture.tenantB, "rahul-b")?.followUpOn,
    ).toBe(asOfOnB);
    expect(countUnreadNotifications(fixture.client.db, fixture.tenantB, { now })).toBe(
      1,
    );
  });

  it("leaves the source opportunity dates byte-identical after a grouped snooze", () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "atlassian",
      name: "Atlassian",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "atlassian-sde",
      companyId: "atlassian",
      role: "SDE",
      deadlineOn: "2026-09-03",
      nextAction: "Submit application",
      nextActionDue: "2026-09-03",
    });
    materializeNotifications(fixture.client.db, fixture.tenantA, { now });
    const before = getOpportunity(
      fixture.client.db,
      fixture.tenantA,
      "atlassian-sde",
    );
    const members = listNotifications(
      fixture.client.db,
      fixture.tenantA,
      "all",
      { now },
    ).filter((row) => row.groupKey === "opportunity:atlassian-sde:apply");
    snoozeNotificationsByPreset(
      fixture.client.db,
      fixture.tenantA,
      members.map((row) => row.id),
      "1h",
      { now },
    );
    const after = getOpportunity(
      fixture.client.db,
      fixture.tenantA,
      "atlassian-sde",
    );
    expect(after?.deadlineOn).toBe(before?.deadlineOn);
    expect(after?.nextActionDue).toBe(before?.nextActionDue);
    expect(after?.stage).toBe(before?.stage);
  });

  it("dismisses and completes without changing the contact follow-up date", () => {
    const fixture = newFixture();
    const asOfOn = calendarDateInZone("Asia/Kolkata", now);
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      followUpOn: asOfOn,
    });
    createTask(fixture.client.db, fixture.tenantA, {
      id: "task-prep",
      title: "Prepare questions",
      dueOn: asOfOn,
    });
    materializeNotifications(fixture.client.db, fixture.tenantA, { now });
    const rows = listNotifications(fixture.client.db, fixture.tenantA, "unread", {
      now,
    });
    const followUp = rows.find((row) => row.entityId === "rahul")!;
    const taskRow = rows.find((row) => row.dueKey === dueSourceKey("task", "task-prep"))!;
    dismissNotifications(fixture.client.db, fixture.tenantA, [followUp.id], now);
    completeNotifications(fixture.client.db, fixture.tenantA, [taskRow.id], now);
    expect(getContact(fixture.client.db, fixture.tenantA, "rahul")?.followUpOn).toBe(
      asOfOn,
    );
    expect(getTask(fixture.client.db, fixture.tenantA, "task-prep")?.status).toBe(
      "completed",
    );
    expect(
      listNotifications(fixture.client.db, fixture.tenantA, "unread", { now }),
    ).toEqual([]);
  });
});

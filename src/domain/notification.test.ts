import { describe, expect, it } from "vitest";

import { dueSourceKey } from "./due-source";
import {
  NOTIFICATION_EMPTY,
  NOTIFICATION_TABS,
  groupNotificationCards,
  isNextPrefetchRequest,
  isSnoozedAt,
  matchesNotificationTab,
  nextMondayOn,
  notificationGroupKey,
  requestForbidsNotificationWrites,
  snoozeUntil,
  startOfZonedDay,
} from "./notification";

describe("notification domain", () => {
  it("keeps the §33 tabs and empty sentence", () => {
    expect(NOTIFICATION_TABS.map(({ label }) => label)).toEqual([
      "Unread",
      "Today",
      "Upcoming",
      "Overdue",
      "Muted",
      "All",
    ]);
    expect(NOTIFICATION_EMPTY).toBe(
      "No notifications. Due follow-ups will land here.",
    );
  });

  it("groups an application deadline, matching next action, and derived task", () => {
    const opportunityId = "atlassian-sde";
    const deadlineKey = dueSourceKey("opportunity_deadline", opportunityId);
    const nextActionKey = dueSourceKey(
      "opportunity_next_action",
      opportunityId,
    );
    const applyGroup = `opportunity:${opportunityId}:apply`;

    expect(
      notificationGroupKey({
        kind: "opportunity_deadline",
        entityId: opportunityId,
      }),
    ).toBe(applyGroup);
    expect(
      notificationGroupKey({
        kind: "opportunity_next_action",
        entityId: opportunityId,
      }),
    ).toBe(applyGroup);
    expect(
      notificationGroupKey({
        kind: "task",
        entityId: "task-apply",
        derivedFromKey: nextActionKey,
      }),
    ).toBe(applyGroup);
    expect(
      notificationGroupKey({
        kind: "task",
        entityId: "task-apply",
        derivedFromKey: deadlineKey,
      }),
    ).toBe(applyGroup);
  });

  it("keeps an unrelated manual task on the same opportunity and day separate", () => {
    expect(
      notificationGroupKey({
        kind: "task",
        entityId: "task-notes",
        derivedFromKey: null,
      }),
    ).toBeNull();
    expect(
      notificationGroupKey({
        kind: "contact_next_action",
        entityId: "rahul",
      }),
    ).toBeNull();

    const cards = groupNotificationCards([
      {
        dueKey: dueSourceKey("opportunity_deadline", "atlassian-sde"),
        groupKey: "opportunity:atlassian-sde:apply",
      },
      {
        dueKey: dueSourceKey("opportunity_next_action", "atlassian-sde"),
        groupKey: "opportunity:atlassian-sde:apply",
      },
      {
        dueKey: dueSourceKey("task", "task-apply"),
        groupKey: "opportunity:atlassian-sde:apply",
      },
      {
        dueKey: dueSourceKey("task", "task-notes"),
        groupKey: null,
      },
    ]);
    expect(cards).toHaveLength(2);
    expect(cards[0]?.members).toHaveLength(3);
    expect(cards[1]?.members).toEqual([
      {
        dueKey: dueSourceKey("task", "task-notes"),
        groupKey: null,
      },
    ]);
  });

  it("computes snooze instants without depending on the source due date", () => {
    const now = new Date("2026-09-02T08:30:00.000Z");
    expect(snoozeUntil("1h", now, "Asia/Kolkata").toISOString()).toBe(
      "2026-09-02T09:30:00.000Z",
    );
    expect(snoozeUntil("3h", now, "Asia/Kolkata").toISOString()).toBe(
      "2026-09-02T11:30:00.000Z",
    );
    expect(nextMondayOn("2026-09-02")).toBe("2026-09-07");
    expect(nextMondayOn("2026-09-07")).toBe("2026-09-14");
    expect(startOfZonedDay("2026-09-03", "Asia/Kolkata").toISOString()).toBe(
      "2026-09-02T18:30:00.000Z",
    );
    expect(snoozeUntil("tomorrow", now, "Asia/Kolkata").toISOString()).toBe(
      "2026-09-02T18:30:00.000Z",
    );
    expect(isSnoozedAt(new Date("2026-09-02T11:00:00.000Z"), now)).toBe(true);
    expect(isSnoozedAt(new Date("2026-09-02T08:00:00.000Z"), now)).toBe(false);
  });

  it("sends muted types to Muted, not Unread, and keeps quiet-hours listing later", () => {
    const now = new Date("2026-09-02T20:00:00.000Z");
    const row = {
      dueOn: "2026-09-02",
      kind: "contact_next_action" as const,
      readAt: null,
      dismissedAt: null,
      completedAt: null,
      snoozedUntil: null,
    };
    const open = {
      asOfOn: "2026-09-02",
      now,
      mutedKinds: new Set<string>(),
    };
    expect(matchesNotificationTab(row, "unread", open)).toBe(true);
    expect(matchesNotificationTab(row, "today", open)).toBe(true);
    expect(
      matchesNotificationTab(row, "unread", {
        ...open,
        mutedKinds: new Set(["contact_next_action"]),
      }),
    ).toBe(false);
    expect(
      matchesNotificationTab(row, "muted", {
        ...open,
        mutedKinds: new Set(["contact_next_action"]),
      }),
    ).toBe(true);
    expect(
      matchesNotificationTab(
        { ...row, snoozedUntil: new Date("2026-09-02T23:00:00.000Z") },
        "unread",
        open,
      ),
    ).toBe(false);
  });

  it("treats Next.js prefetch headers as a forbidden write", () => {
    const headers = new Headers({ "next-router-prefetch": "1" });
    expect(isNextPrefetchRequest(headers)).toBe(true);
    expect(
      requestForbidsNotificationWrites(
        new Request("https://jobpilot.invalid.test/api/notifications/materialize", {
          method: "POST",
          headers,
        }),
      ),
    ).toBe(true);
    expect(
      requestForbidsNotificationWrites(
        new Request("https://jobpilot.invalid.test/notifications", {
          method: "GET",
        }),
      ),
    ).toBe(true);
    expect(
      requestForbidsNotificationWrites(
        new Request("https://jobpilot.invalid.test/api/notifications/materialize", {
          method: "POST",
        }),
      ),
    ).toBe(false);
  });
});

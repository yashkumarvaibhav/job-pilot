import { afterEach, describe, expect, it } from "vitest";

import { dueSourceKey } from "../../domain/due-source";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createCompany, updateCompany } from "./companies";
import { createContact, updateContact } from "./contacts";
import { createOpportunity, updateOpportunity } from "./opportunities";
import { createReferral, updateReferral } from "./referrals";
import {
  TaskInputError,
  completeTask,
  createTask,
  createTaskFromDerived,
  getTask,
  listDueItems,
  listTasks,
} from "./tasks";

describe("task repository", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  function seedRahul(
    fixture: ReturnType<typeof createTenantTestFixture>,
    tenant: "tenantA" | "tenantB",
  ) {
    const owner = fixture[tenant];
    const prefix = tenant === "tenantA" ? "" : "b-";
    createCompany(fixture.client.db, owner, {
      id: `${prefix}microsoft`,
      name: tenant === "tenantA" ? "Microsoft" : "Private Co",
    });
    createContact(fixture.client.db, owner, {
      id: `${prefix}rahul`,
      companyId: `${prefix}microsoft`,
      name: tenant === "tenantA" ? "Rahul Sharma" : "Hidden Person",
    });
    createOpportunity(fixture.client.db, owner, {
      id: `${prefix}ms-sde`,
      companyId: `${prefix}microsoft`,
      role: tenant === "tenantA" ? "SDE" : "Private Role",
    });
  }

  it("creates a task without a link and completes it idempotently", () => {
    const fixture = newFixture();
    const created = createTask(fixture.client.db, fixture.tenantA, {
      id: "task-prep",
      title: "Prepare system design",
      dueOn: "2026-09-07",
      now: new Date("2026-09-01T12:00:00.000Z"),
    });

    expect(created).toMatchObject({
      id: "task-prep",
      title: "Prepare system design",
      dueOn: "2026-09-07",
      status: "open",
      source: "manual",
      entityType: null,
      entityId: null,
      derivedFromKey: null,
      completedAt: null,
    });
    expect(
      fixture.client.sqlite
        .prepare(
          "select kind from activity_event where workspace_id = ? and entity_id = ?",
        )
        .all(fixture.tenantA.workspaceId, created.id),
    ).toEqual([{ kind: "TASK_CREATED" }]);

    const first = completeTask(
      fixture.client.db,
      fixture.tenantA,
      created.id,
      new Date("2026-09-01T12:05:00.000Z"),
    );
    const second = completeTask(
      fixture.client.db,
      fixture.tenantA,
      created.id,
      new Date("2026-09-01T12:06:00.000Z"),
    );

    expect(first).toMatchObject({ status: "completed" });
    expect(second).toMatchObject({
      status: "completed",
      completedAt: first?.completedAt,
    });
    expect(listTasks(fixture.client.db, fixture.tenantA)).toEqual([]);
    expect(
      listTasks(fixture.client.db, fixture.tenantA, { status: "completed" }),
    ).toEqual([expect.objectContaining({ id: "task-prep" })]);
    expect(
      fixture.client.sqlite
        .prepare(
          "select kind from activity_event where workspace_id = ? and kind = 'TASK_COMPLETED'",
        )
        .all(fixture.tenantA.workspaceId),
    ).toEqual([{ kind: "TASK_COMPLETED" }]);
  });

  it("keeps a contact next action and an unrelated linked task as two due items", () => {
    const fixture = newFixture();
    seedRahul(fixture, "tenantA");
    updateContact(fixture.client.db, fixture.tenantA, "rahul", {
      nextAction: "Follow up about Microsoft openings",
      followUpOn: "2026-09-02",
    });
    createTask(fixture.client.db, fixture.tenantA, {
      id: "task-resume",
      title: "Send resume",
      dueOn: "2026-09-02",
      entityType: "contact",
      entityId: "rahul",
    });

    const items = listDueItems(fixture.client.db, fixture.tenantA);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: dueSourceKey("contact_next_action", "rahul"),
          origin: "derived",
          title: "Follow up about Microsoft openings",
          dueOn: "2026-09-02",
        }),
        expect.objectContaining({
          sourceKey: dueSourceKey("task", "task-resume"),
          origin: "task",
          title: "Send resume",
          dueOn: "2026-09-02",
        }),
      ]),
    );
    expect(items).toHaveLength(2);
  });

  it("converts a derived next action into one task that suppresses only that source", () => {
    const fixture = newFixture();
    seedRahul(fixture, "tenantA");
    updateContact(fixture.client.db, fixture.tenantA, "rahul", {
      nextAction: "Follow up about Microsoft openings",
      followUpOn: "2026-09-02",
    });
    createTask(fixture.client.db, fixture.tenantA, {
      id: "task-resume",
      title: "Send resume",
      dueOn: "2026-09-02",
      entityType: "contact",
      entityId: "rahul",
    });

    const converted = createTaskFromDerived(fixture.client.db, fixture.tenantA, {
      sourceKey: dueSourceKey("contact_next_action", "rahul"),
      id: "task-follow-up",
      now: new Date("2026-09-01T12:00:00.000Z"),
    });
    const again = createTaskFromDerived(fixture.client.db, fixture.tenantA, {
      sourceKey: dueSourceKey("contact_next_action", "rahul"),
    });

    expect(converted).toMatchObject({
      id: "task-follow-up",
      title: "Follow up about Microsoft openings",
      dueOn: "2026-09-02",
      entityType: "contact",
      entityId: "rahul",
      derivedFromKey: dueSourceKey("contact_next_action", "rahul"),
      status: "open",
    });
    expect(again?.id).toBe(converted?.id);

    const items = listDueItems(fixture.client.db, fixture.tenantA);
    expect(
      items.filter(
        (item) =>
          item.sourceKey === dueSourceKey("contact_next_action", "rahul") ||
          item.derivedFromKey === dueSourceKey("contact_next_action", "rahul"),
      ),
    ).toHaveLength(1);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          origin: "task",
          title: "Follow up about Microsoft openings",
          derivedFromKey: dueSourceKey("contact_next_action", "rahul"),
        }),
        expect.objectContaining({
          origin: "task",
          title: "Send resume",
          derivedFromKey: null,
        }),
      ]),
    );
    expect(items).toHaveLength(2);
  });

  it("scopes links, due keys and suppression to the owning workspace", () => {
    const fixture = newFixture();
    seedRahul(fixture, "tenantA");
    seedRahul(fixture, "tenantB");
    updateContact(fixture.client.db, fixture.tenantA, "rahul", {
      nextAction: "Follow up about Microsoft openings",
      followUpOn: "2026-09-02",
    });
    updateContact(fixture.client.db, fixture.tenantB, "b-rahul", {
      nextAction: "Follow up about Microsoft openings",
      followUpOn: "2026-09-02",
    });

    expect(() =>
      createTask(fixture.client.db, fixture.tenantA, {
        title: "Steal",
        entityType: "contact",
        entityId: "b-rahul",
      }),
    ).toThrow(TaskInputError);

    const owned = createTask(fixture.client.db, fixture.tenantA, {
      id: "task-a",
      title: "Prepare system design",
      dueOn: "2026-09-07",
    });
    const before = fixture.rowCount("activity_event");

    expect(getTask(fixture.client.db, fixture.tenantB, owned.id)).toBeUndefined();
    expect(listTasks(fixture.client.db, fixture.tenantB)).toEqual([]);
    expect(
      completeTask(fixture.client.db, fixture.tenantB, owned.id),
    ).toBeUndefined();
    expect(
      createTaskFromDerived(fixture.client.db, fixture.tenantB, {
        sourceKey: dueSourceKey("contact_next_action", "rahul"),
      }),
    ).toBeUndefined();
    expect(fixture.rowCount("activity_event")).toBe(before);
    expect(
      listDueItems(fixture.client.db, fixture.tenantA).map((item) => item.sourceKey),
    ).toEqual([
      dueSourceKey("contact_next_action", "rahul"),
      dueSourceKey("task", "task-a"),
    ]);
    expect(
      listDueItems(fixture.client.db, fixture.tenantB).map((item) => item.sourceKey),
    ).toEqual([dueSourceKey("contact_next_action", "b-rahul")]);
  });

  it("reads company and opportunity next-action due dates through the same keys", () => {
    const fixture = newFixture();
    seedRahul(fixture, "tenantA");
    updateCompany(fixture.client.db, fixture.tenantA, "microsoft", {
      nextAction: "Check careers page",
      nextActionDue: "2026-09-03",
    });
    updateOpportunity(fixture.client.db, fixture.tenantA, "ms-sde", {
      nextAction: "Ask for referral",
      nextActionDue: "2026-09-03",
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "referral-rahul",
      contactId: "rahul",
      opportunityId: "ms-sde",
      channel: "whatsapp",
    });
    updateReferral(fixture.client.db, fixture.tenantA, "referral-rahul", {
      nextAction: "Nudge about the portal",
      followUpOn: "2026-09-04",
    });

    const keys = listDueItems(fixture.client.db, fixture.tenantA).map(
      (item) => item.sourceKey,
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        dueSourceKey("company_next_action", "microsoft"),
        dueSourceKey("opportunity_next_action", "ms-sde"),
        dueSourceKey("referral_follow_up", "referral-rahul"),
      ]),
    );
  });
});

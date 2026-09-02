import { describe, expect, it } from "vitest";

import {
  createAccountFoundation,
  getActivityEvent,
  getWorkspaceSettings,
  updateWorkspaceTimezone,
} from "./foundation";
import { logEvent } from "./activity";
import { userAccount } from "./schema";
import { createTenantTestFixture } from "../../test/tenant-fixture";

describe("account tenancy foundation", () => {
  it("creates one account, workspace and settings row atomically", () => {
    const fixture = createTenantTestFixture({ seedTenants: false });

    try {
      const result = createAccountFoundation(fixture.client.db, {
        emailNormalized: "owner@invalid.test",
        passwordHash: "synthetic-password-hash",
        displayName: "Owner",
        ids: { userId: "user-owner", workspaceId: "workspace-owner" },
        now: new Date("2026-08-31T12:00:00.000Z"),
      });

      expect(result.tenant).toEqual({
        userId: "user-owner",
        workspaceId: "workspace-owner",
      });
      expect(fixture.rowCount("user_account")).toBe(1);
      expect(fixture.rowCount("workspace")).toBe(1);
      expect(fixture.rowCount("settings")).toBe(1);
      expect(fixture.rowCount("automation_rule")).toBe(11);
      expect(fixture.rowCount("activity_event")).toBe(1);

      const storedSettings = getWorkspaceSettings(
        fixture.client.db,
        result.tenant,
        result.tenant.workspaceId,
      );
      expect(storedSettings?.timezone).toBe("Asia/Kolkata");
    } finally {
      fixture.dispose();
    }
  });

  it("rolls back all foundation rows when a later insert fails", () => {
    const fixture = createTenantTestFixture({ seedTenants: false });

    try {
      createAccountFoundation(fixture.client.db, {
        emailNormalized: "first@invalid.test",
        passwordHash: "synthetic-password-hash",
        ids: { userId: "user-first", workspaceId: "workspace-shared" },
      });

      expect(() =>
        createAccountFoundation(fixture.client.db, {
          emailNormalized: "rolled-back@invalid.test",
          passwordHash: "synthetic-password-hash",
          ids: { userId: "user-rolled-back", workspaceId: "workspace-shared" },
        }),
      ).toThrow();

      expect(fixture.rowCount("user_account")).toBe(1);
      expect(fixture.rowCount("workspace")).toBe(1);
      expect(fixture.rowCount("settings")).toBe(1);
      expect(fixture.rowCount("automation_rule")).toBe(11);
      expect(fixture.rowCount("activity_event")).toBe(1);
    } finally {
      fixture.dispose();
    }
  });

  it("isolates settings and activity across two workspaces", () => {
    const fixture = createTenantTestFixture();

    try {
      expect(
        getWorkspaceSettings(
          fixture.client.db,
          fixture.tenantA,
          fixture.tenantB.workspaceId,
        ),
      ).toBeUndefined();

      const eventB = fixture.client.db.transaction((transaction) =>
        logEvent(transaction, fixture.tenantB, {
          id: "event-b",
          at: new Date("2026-08-31T13:00:00.000Z"),
          kind: "CONTACT_CREATED",
          entityType: "contact",
          entityId: "same-looking-contact-id",
        }),
      );

      expect(
        getActivityEvent(fixture.client.db, fixture.tenantA, eventB.id),
      ).toBeUndefined();
      expect(
        getActivityEvent(fixture.client.db, fixture.tenantB, eventB.id),
      ).toMatchObject({ workspaceId: fixture.tenantB.workspaceId });

      const maliciousEvent = fixture.client.db.transaction((transaction) =>
        logEvent(transaction, fixture.tenantA, {
          id: "event-a",
          kind: "CONTACT_CREATED",
          entityType: "contact",
          entityId: "same-looking-contact-id",
          workspaceId: fixture.tenantB.workspaceId,
        } as Parameters<typeof logEvent>[2] & { workspaceId: string }),
      );
      expect(maliciousEvent.workspaceId).toBe(fixture.tenantA.workspaceId);
    } finally {
      fixture.dispose();
    }
  });

  it("validates timezone writes without changing stored UTC instants", () => {
    const fixture = createTenantTestFixture();

    try {
      const before = fixture.client.db
        .select({ createdAt: userAccount.createdAt })
        .from(userAccount)
        .get();
      const eventCount = fixture.rowCount("activity_event");

      expect(() =>
        updateWorkspaceTimezone(
          fixture.client.db,
          fixture.tenantA,
          fixture.tenantA.workspaceId,
          "Mars/Olympus",
        ),
      ).toThrow("Invalid IANA timezone: Mars/Olympus");
      expect(
        updateWorkspaceTimezone(
          fixture.client.db,
          fixture.tenantA,
          fixture.tenantB.workspaceId,
          "Europe/London",
        ),
      ).toBe(false);
      expect(fixture.rowCount("activity_event")).toBe(eventCount);

      expect(
        updateWorkspaceTimezone(
          fixture.client.db,
          fixture.tenantA,
          fixture.tenantA.workspaceId,
          "Europe/London",
          new Date("2026-08-31T14:00:00.000Z"),
        ),
      ).toBe(true);

      const after = fixture.client.db
        .select({ createdAt: userAccount.createdAt })
        .from(userAccount)
        .get();
      expect(after?.createdAt.toISOString()).toBe(
        before?.createdAt.toISOString(),
      );
      expect(
        getWorkspaceSettings(
          fixture.client.db,
          fixture.tenantA,
          fixture.tenantA.workspaceId,
        )?.timezone,
      ).toBe("Europe/London");
    } finally {
      fixture.dispose();
    }
  });
});

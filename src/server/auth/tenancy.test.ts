import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import {
  getWorkspaceSettings,
  updateWorkspaceTimezone,
} from "../db/foundation";
import { registerAccount } from "./accounts";
import { resolveSessionTenant, startSession } from "./session";

const PASSWORD = "synthetic-owner-password";

/**
 * The session layer is where a request becomes workspace authority, so the
 * D-035 isolation contract is asserted through it and not only through the
 * repository: A's cookie must be unable to reach B even when B's workspace id
 * is handed to the query.
 */
describe("a session only reaches its own workspace", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
  });

  async function twoAccounts() {
    const fixture = createTenantTestFixture({ seedTenants: false });
    fixtures.push(fixture);

    const a = await registerAccount(fixture.client.db, {
      username: "tenant_a",
      password: PASSWORD,
      displayName: "Account A",
      timezone: "Asia/Kolkata",
    });
    const b = await registerAccount(fixture.client.db, {
      username: "tenant_b",
      password: PASSWORD,
      displayName: "Account B",
      timezone: "America/New_York",
    });

    if (!a.ok || !b.ok) {
      throw new Error("fixture accounts could not be created");
    }

    const sessionA = startSession(fixture.client.db, a.tenant.userId);
    const sessionB = startSession(fixture.client.db, b.tenant.userId);

    return {
      fixture,
      tenantA: a.tenant,
      tenantB: b.tenant,
      resolvedA: resolveSessionTenant(fixture.client.db, sessionA.token),
      resolvedB: resolveSessionTenant(fixture.client.db, sessionB.token),
    };
  }

  it("resolves each cookie to its own workspace and settings", async () => {
    const { fixture, tenantA, tenantB, resolvedA, resolvedB } =
      await twoAccounts();

    expect(resolvedA).toEqual(tenantA);
    expect(resolvedB).toEqual(tenantB);
    expect(
      getWorkspaceSettings(fixture.client.db, resolvedA!, tenantA.workspaceId)
        ?.timezone,
    ).toBe("Asia/Kolkata");
    expect(
      getWorkspaceSettings(fixture.client.db, resolvedB!, tenantB.workspaceId)
        ?.timezone,
    ).toBe("America/New_York");
  });

  it("treats the other workspace's id as missing rather than forbidden", async () => {
    const { fixture, tenantA, tenantB, resolvedA } = await twoAccounts();

    const foreign = getWorkspaceSettings(
      fixture.client.db,
      resolvedA!,
      tenantB.workspaceId,
    );
    const missing = getWorkspaceSettings(
      fixture.client.db,
      resolvedA!,
      "workspace-that-does-not-exist",
    );

    expect(foreign).toBeUndefined();
    expect(foreign).toEqual(missing);
    expect(
      getWorkspaceSettings(fixture.client.db, resolvedA!, tenantA.workspaceId),
    ).toBeDefined();
  });

  it("refuses a cross-workspace write and logs no event for the other account", async () => {
    const { fixture, tenantB, resolvedA } = await twoAccounts();
    const eventsBefore = fixture.rowCount("activity_event");

    expect(
      updateWorkspaceTimezone(
        fixture.client.db,
        resolvedA!,
        tenantB.workspaceId,
        "Europe/London",
      ),
    ).toBe(false);

    expect(fixture.rowCount("activity_event")).toBe(eventsBefore);
    expect(
      fixture.client.sqlite
        .prepare("select timezone from settings where workspace_id = ?")
        .get(tenantB.workspaceId),
    ).toEqual({ timezone: "America/New_York" });
  });

  it("does not let a revoked or unknown cookie borrow another workspace", async () => {
    const { fixture, tenantB } = await twoAccounts();

    const stranger = resolveSessionTenant(fixture.client.db, "not-a-token");

    expect(stranger).toBeNull();
    expect(
      fixture.client.sqlite
        .prepare("select count(*) as count from workspace where id = ?")
        .get(tenantB.workspaceId),
    ).toEqual({ count: 1 });
  });
});

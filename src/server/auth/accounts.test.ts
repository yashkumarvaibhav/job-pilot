import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { authenticateAccount, registerAccount } from "./accounts";
import { hashPassword } from "./password";
import { createAccountFoundation } from "../db/foundation";

const PASSWORD = "synthetic-owner-password";

describe("registerAccount", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
  });

  function newFixture() {
    const fixture = createTenantTestFixture({ seedTenants: false });
    fixtures.push(fixture);
    return fixture;
  }

  it("creates one account, one private workspace and its settings", async () => {
    const fixture = newFixture();

    const result = await registerAccount(fixture.client.db, {
      username: "  Owner_Name ",
      password: PASSWORD,
    });

    expect(result.ok).toBe(true);
    expect(fixture.rowCount("user_account")).toBe(1);
    expect(fixture.rowCount("workspace")).toBe(1);
    expect(fixture.rowCount("settings")).toBe(1);

    const stored = fixture.client.sqlite
      .prepare("select username_normalized, password_hash from user_account")
      .get() as { username_normalized: string; password_hash: string };

    expect(stored.username_normalized).toBe("owner_name");
    expect(stored.password_hash).not.toContain(PASSWORD);
    expect(stored.password_hash.startsWith("scrypt$")).toBe(true);
  });

  it("gives a second account its own empty workspace", async () => {
    const fixture = newFixture();

    const first = await registerAccount(fixture.client.db, {
      username: "owner_one",
      password: PASSWORD,
    });
    const second = await registerAccount(fixture.client.db, {
      username: "owner_two",
      password: PASSWORD,
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }

    expect(first.tenant.workspaceId).not.toBe(second.tenant.workspaceId);
    expect(first.tenant.userId).not.toBe(second.tenant.userId);
    expect(fixture.rowCount("workspace")).toBe(2);
  });

  it("refuses a duplicate username without confirming it exists", async () => {
    const fixture = newFixture();

    await registerAccount(fixture.client.db, {
      username: "owner_name",
      password: PASSWORD,
    });
    const duplicate = await registerAccount(fixture.client.db, {
      username: "OWNER_NAME",
      password: PASSWORD,
    });
    const malformed = await registerAccount(fixture.client.db, {
      username: "owner@example.com",
      password: PASSWORD,
    });

    expect(duplicate).toEqual({ ok: false });
    expect(duplicate).toEqual(malformed);
    expect(fixture.rowCount("user_account")).toBe(1);
    expect(fixture.rowCount("workspace")).toBe(1);
  });

  it("rejects a password below the published minimum and writes nothing", async () => {
    const fixture = newFixture();

    const result = await registerAccount(fixture.client.db, {
      username: "owner_name",
      password: "short",
    });

    expect(result).toEqual({ ok: false });
    expect(fixture.rowCount("user_account")).toBe(0);
    expect(fixture.rowCount("workspace")).toBe(0);
    expect(fixture.rowCount("settings")).toBe(0);
    expect(fixture.rowCount("activity_event")).toBe(0);
  });

  it("leaves no partial rows when the transaction fails", async () => {
    const fixture = newFixture();

    await registerAccount(fixture.client.db, {
      username: "owner_name",
      password: PASSWORD,
    });
    const before = fixture.rowCount("activity_event");

    await registerAccount(fixture.client.db, {
      username: "owner_name",
      password: PASSWORD,
    });

    expect(fixture.rowCount("activity_event")).toBe(before);
  });
});

describe("authenticateAccount", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
  });

  function newFixture() {
    const fixture = createTenantTestFixture({ seedTenants: false });
    fixtures.push(fixture);
    return fixture;
  }

  it("returns the account for the right password", async () => {
    const fixture = newFixture();
    const created = await registerAccount(fixture.client.db, {
      username: "owner_name",
      password: PASSWORD,
    });

    const authenticated = await authenticateAccount(fixture.client.db, {
      username: " Owner_Name ",
      password: PASSWORD,
    });

    expect(authenticated).toEqual(
      created.ok
        ? { userId: created.tenant.userId, signupComplete: true }
        : null,
    );
  });

  it("returns null for a wrong password and for an unknown username", async () => {
    const fixture = newFixture();
    await registerAccount(fixture.client.db, {
      username: "owner_name",
      password: PASSWORD,
    });

    await expect(
      authenticateAccount(fixture.client.db, {
        username: "owner_name",
        password: `${PASSWORD}!`,
      }),
    ).resolves.toBeNull();
    await expect(
      authenticateAccount(fixture.client.db, {
        username: "nobody_here",
        password: PASSWORD,
      }),
    ).resolves.toBeNull();
    await expect(
      authenticateAccount(fixture.client.db, {
        username: "not valid",
        password: PASSWORD,
      }),
    ).resolves.toBeNull();
  });

  it("keeps a grandfathered email-shaped identifier usable after migration", async () => {
    const fixture = newFixture();
    const passwordHash = await hashPassword(PASSWORD);
    const created = createAccountFoundation(fixture.client.db, {
      usernameNormalized: "legacy@invalid.test",
      passwordHash,
    });

    await expect(
      authenticateAccount(fixture.client.db, {
        username: " Legacy@Invalid.Test ",
        password: PASSWORD,
      }),
    ).resolves.toEqual({ userId: created.tenant.userId, signupComplete: true });
  });

  it("reports an unfinished mandatory enrollment without rejecting the password", async () => {
    const fixture = newFixture();
    const created = await registerAccount(fixture.client.db, {
      username: "setup_owner",
      password: PASSWORD,
      completeSignup: false,
    });
    if (!created.ok) throw new Error("fixture account was not created");

    await expect(
      authenticateAccount(fixture.client.db, {
        username: "setup_owner",
        password: PASSWORD,
      }),
    ).resolves.toEqual({ userId: created.tenant.userId, signupComplete: false });
  });
});

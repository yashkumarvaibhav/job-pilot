import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { authenticateAccount, registerAccount } from "./accounts";

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
      email: "  Owner@Invalid.TEST ",
      password: PASSWORD,
    });

    expect(result.ok).toBe(true);
    expect(fixture.rowCount("user_account")).toBe(1);
    expect(fixture.rowCount("workspace")).toBe(1);
    expect(fixture.rowCount("settings")).toBe(1);

    const stored = fixture.client.sqlite
      .prepare("select email_normalized, password_hash from user_account")
      .get() as { email_normalized: string; password_hash: string };

    expect(stored.email_normalized).toBe("owner@invalid.test");
    expect(stored.password_hash).not.toContain(PASSWORD);
    expect(stored.password_hash.startsWith("scrypt$")).toBe(true);
  });

  it("gives a second account its own empty workspace", async () => {
    const fixture = newFixture();

    const first = await registerAccount(fixture.client.db, {
      email: "one@invalid.test",
      password: PASSWORD,
    });
    const second = await registerAccount(fixture.client.db, {
      email: "two@invalid.test",
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

  it("refuses a duplicate address without confirming it exists", async () => {
    const fixture = newFixture();

    await registerAccount(fixture.client.db, {
      email: "owner@invalid.test",
      password: PASSWORD,
    });
    const duplicate = await registerAccount(fixture.client.db, {
      email: "OWNER@invalid.test",
      password: PASSWORD,
    });
    const malformed = await registerAccount(fixture.client.db, {
      email: "not-an-address",
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
      email: "owner@invalid.test",
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
      email: "owner@invalid.test",
      password: PASSWORD,
    });
    const before = fixture.rowCount("activity_event");

    await registerAccount(fixture.client.db, {
      email: "owner@invalid.test",
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
      email: "owner@invalid.test",
      password: PASSWORD,
    });

    const authenticated = await authenticateAccount(fixture.client.db, {
      email: " Owner@Invalid.test ",
      password: PASSWORD,
    });

    expect(created.ok && authenticated?.userId).toBe(
      created.ok ? created.tenant.userId : undefined,
    );
  });

  it("returns null for a wrong password and for an unknown address", async () => {
    const fixture = newFixture();
    await registerAccount(fixture.client.db, {
      email: "owner@invalid.test",
      password: PASSWORD,
    });

    await expect(
      authenticateAccount(fixture.client.db, {
        email: "owner@invalid.test",
        password: `${PASSWORD}!`,
      }),
    ).resolves.toBeNull();
    await expect(
      authenticateAccount(fixture.client.db, {
        email: "nobody@invalid.test",
        password: PASSWORD,
      }),
    ).resolves.toBeNull();
    await expect(
      authenticateAccount(fixture.client.db, {
        email: "not-an-address",
        password: PASSWORD,
      }),
    ).resolves.toBeNull();
  });

  it("allows an explicitly unverified account only when its caller opts in", async () => {
    const fixture = newFixture();
    const created = await registerAccount(fixture.client.db, {
      email: "early-access@invalid.test",
      password: PASSWORD,
      emailVerifiedAt: null,
    });

    await expect(
      authenticateAccount(fixture.client.db, {
        email: "early-access@invalid.test",
        password: PASSWORD,
      }),
    ).resolves.toBeNull();
    const authenticated = await authenticateAccount(
      fixture.client.db,
      {
        email: "early-access@invalid.test",
        password: PASSWORD,
      },
      { allowUnverified: true },
    );
    expect(created.ok && authenticated?.userId).toBe(
      created.ok ? created.tenant.userId : undefined,
    );
  });
});

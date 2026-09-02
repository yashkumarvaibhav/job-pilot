import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { authenticateAccount, registerAccount } from "./accounts";
import {
  EMAIL_VERIFICATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  registerAccountWithVerification,
  requestEmailVerification,
  requestPasswordReset,
  resetPasswordWithToken,
  verifyEmailToken,
} from "./account-lifecycle";
import { MemoryAccountMailPort } from "./account-mail";
import { resolveSessionTenant, startSession } from "./session";

const START = new Date("2026-09-02T16:30:00.000Z");
const PASSWORD = "synthetic-owner-password";
const NEXT_PASSWORD = "synthetic-next-password";
const ORIGIN = "https://jobpilot.invalid.test";

function tokenFrom(url: string): string {
  const token = new URL(url).searchParams.get("token");
  if (!token) throw new Error("Fixture delivery did not contain a token.");
  return token;
}

describe("account verification and recovery", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function newFixture() {
    const fixture = createTenantTestFixture({ seedTenants: false });
    fixtures.push(fixture);
    return fixture;
  }

  it("stores only a verification digest and admits the account after one use", async () => {
    const fixture = newFixture();
    const mail = new MemoryAccountMailPort();
    const created = await registerAccountWithVerification(
      fixture.client.db,
      { email: "Owner@Invalid.TEST", password: PASSWORD, now: START },
      mail,
      ORIGIN,
    );

    expect(created.ok).toBe(true);
    expect(mail.deliveries).toHaveLength(1);
    expect(mail.deliveries[0]).toMatchObject({
      kind: "verify_email",
      recipient: "owner@invalid.test",
    });
    const token = tokenFrom(mail.deliveries[0]!.url);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);

    const tokenRow = fixture.client.sqlite
      .prepare("select * from account_token")
      .get() as Record<string, unknown>;
    expect(JSON.stringify(tokenRow)).not.toContain(token);
    expect(tokenRow.used_at).toBeNull();
    expect(
      await authenticateAccount(fixture.client.db, {
        email: "owner@invalid.test",
        password: PASSWORD,
      }),
    ).toBeNull();

    expect(verifyEmailToken(fixture.client.db, token, START)).toBe(true);
    expect(verifyEmailToken(fixture.client.db, token, START)).toBe(false);
    expect(
      await authenticateAccount(fixture.client.db, {
        email: "owner@invalid.test",
        password: PASSWORD,
      }),
    ).not.toBeNull();

    const serialized = JSON.stringify({
      accounts: fixture.client.sqlite.prepare("select * from user_account").all(),
      tokens: fixture.client.sqlite.prepare("select * from account_token").all(),
      activity: fixture.client.sqlite.prepare("select * from activity_event").all(),
    });
    expect(serialized).not.toContain(token);
  });

  it("expires verification links and supersedes an earlier resend", async () => {
    const fixture = newFixture();
    const mail = new MemoryAccountMailPort();
    await registerAccountWithVerification(
      fixture.client.db,
      { email: "owner@invalid.test", password: PASSWORD, now: START },
      mail,
      ORIGIN,
    );
    const first = tokenFrom(mail.deliveries[0]!.url);

    await requestEmailVerification(
      fixture.client.db,
      "owner@invalid.test",
      mail,
      ORIGIN,
      new Date(START.getTime() + 1_000),
    );
    const second = tokenFrom(mail.deliveries[1]!.url);

    expect(second).not.toBe(first);
    expect(verifyEmailToken(fixture.client.db, first, START)).toBe(false);
    expect(
      verifyEmailToken(
        fixture.client.db,
        second,
        new Date(START.getTime() + EMAIL_VERIFICATION_TTL_MS + 1_001),
      ),
    ).toBe(false);
  });

  it("answers unknown and existing recovery requests alike without fake delivery", async () => {
    const fixture = newFixture();
    const mail = new MemoryAccountMailPort();
    await registerAccount(fixture.client.db, {
      email: "owner@invalid.test",
      password: PASSWORD,
      now: START,
    });

    await requestPasswordReset(
      fixture.client.db,
      "missing@invalid.test",
      mail,
      ORIGIN,
      START,
    );
    await requestPasswordReset(
      fixture.client.db,
      "owner@invalid.test",
      mail,
      ORIGIN,
      START,
    );

    expect(mail.deliveries).toHaveLength(1);
    expect(mail.deliveries[0]?.recipient).toBe("owner@invalid.test");
    expect(fixture.rowCount("account_token")).toBe(1);
  });

  it("resets once, changes the password and revokes every prior session", async () => {
    const fixture = newFixture();
    const mail = new MemoryAccountMailPort();
    const created = await registerAccount(fixture.client.db, {
      email: "owner@invalid.test",
      password: PASSWORD,
      now: START,
    });
    if (!created.ok) throw new Error("Synthetic account was not created.");
    const laptop = startSession(fixture.client.db, created.tenant.userId, {
      now: START,
    });
    const phone = startSession(fixture.client.db, created.tenant.userId, {
      now: START,
    });

    await requestPasswordReset(
      fixture.client.db,
      "owner@invalid.test",
      mail,
      ORIGIN,
      START,
    );
    const token = tokenFrom(mail.deliveries[0]!.url);

    await expect(
      resetPasswordWithToken(
        fixture.client.db,
        token,
        NEXT_PASSWORD,
        START,
      ),
    ).resolves.toBe(true);
    await expect(
      resetPasswordWithToken(
        fixture.client.db,
        token,
        "another-valid-password",
        START,
      ),
    ).resolves.toBe(false);
    expect(resolveSessionTenant(fixture.client.db, laptop.token, START)).toBeNull();
    expect(resolveSessionTenant(fixture.client.db, phone.token, START)).toBeNull();
    expect(
      await authenticateAccount(fixture.client.db, {
        email: "owner@invalid.test",
        password: PASSWORD,
      }),
    ).toBeNull();
    expect(
      await authenticateAccount(fixture.client.db, {
        email: "owner@invalid.test",
        password: NEXT_PASSWORD,
      }),
    ).not.toBeNull();
  });

  it("refuses an expired reset token without changing the password", async () => {
    const fixture = newFixture();
    const mail = new MemoryAccountMailPort();
    await registerAccount(fixture.client.db, {
      email: "owner@invalid.test",
      password: PASSWORD,
      now: START,
    });
    await requestPasswordReset(
      fixture.client.db,
      "owner@invalid.test",
      mail,
      ORIGIN,
      START,
    );
    const token = tokenFrom(mail.deliveries[0]!.url);

    await expect(
      resetPasswordWithToken(
        fixture.client.db,
        token,
        NEXT_PASSWORD,
        new Date(START.getTime() + PASSWORD_RESET_TTL_MS),
      ),
    ).resolves.toBe(false);
    expect(
      await authenticateAccount(fixture.client.db, {
        email: "owner@invalid.test",
        password: PASSWORD,
      }),
    ).not.toBeNull();
  });
});

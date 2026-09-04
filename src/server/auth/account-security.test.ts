import { describe, expect, it } from "vitest";

import { registerAccount, authenticateAccount } from "./accounts";
import {
  changePasswordWithTotp,
  confirmTotpEnrollment,
  readAccountSecurity,
  resetPasswordWithTotp,
  startTotpEnrollment,
} from "./account-security";
import { generateTotpCode } from "./totp";
import { startSession, resolveSessionTenant } from "./session";
import { userAccount } from "../db/schema";
import { createTenantTestFixture } from "../../test/tenant-fixture";

const TOKEN_KEY = Buffer.alloc(32, 29).toString("base64");
const PASSWORD = "synthetic-owner-password";
const NEXT_PASSWORD = "synthetic-next-password";
const RESET_PASSWORD = "synthetic-reset-password";
const SECRET_BYTES = Buffer.from("12345678901234567890", "ascii");
const AT = new Date("2026-09-04T08:00:00.000Z");

describe("TOTP account security", () => {
  it("stores a pending secret encrypted and grants recovery only after confirmation", async () => {
    const fixture = createTenantTestFixture({ seedTenants: false });
    try {
      const created = await registerAccount(fixture.client.db, {
        username: "owner_name",
        password: PASSWORD,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const setup = startTotpEnrollment(fixture.client.db, created.tenant, {
        tokenKey: TOKEN_KEY,
        secretBytes: SECRET_BYTES,
        now: AT,
      });
      expect(setup?.secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");

      const stored = fixture.client.db
        .select({
          blob: userAccount.totpSecretBlob,
          enabledAt: userAccount.totpEnabledAt,
        })
        .from(userAccount)
        .get();
      expect(stored?.blob).not.toContain(setup?.secret);
      expect(stored?.enabledAt).toBeNull();
      expect(readAccountSecurity(fixture.client.db, created.tenant, TOKEN_KEY)).toMatchObject({
        username: "owner_name",
        totpEnabled: false,
        setup,
      });

      const code = generateTotpCode(setup!.secret, AT);
      expect(
        confirmTotpEnrollment(fixture.client.db, created.tenant, code, {
          tokenKey: TOKEN_KEY,
          now: AT,
        }),
      ).toBe(true);
      expect(readAccountSecurity(fixture.client.db, created.tenant, TOKEN_KEY)).toEqual({
        username: "owner_name",
        totpEnabled: true,
        setup: null,
      });
    } finally {
      fixture.dispose();
    }
  });

  it("changes and resets a password with replay-safe TOTP while revoking sessions", async () => {
    const fixture = createTenantTestFixture({ seedTenants: false });
    try {
      const created = await registerAccount(fixture.client.db, {
        username: "owner_name",
        password: PASSWORD,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const setup = startTotpEnrollment(fixture.client.db, created.tenant, {
        tokenKey: TOKEN_KEY,
        secretBytes: SECRET_BYTES,
        now: AT,
      });
      const firstCode = generateTotpCode(setup!.secret, AT);
      expect(
        confirmTotpEnrollment(fixture.client.db, created.tenant, firstCode, {
          tokenKey: TOKEN_KEY,
          now: AT,
        }),
      ).toBe(true);

      const firstSession = startSession(fixture.client.db, created.tenant.userId, {
        now: AT,
      });
      const changeAt = new Date(AT.getTime() + 30_000);
      const changeCode = generateTotpCode(setup!.secret, changeAt);
      expect(
        await changePasswordWithTotp(
          fixture.client.db,
          created.tenant,
          {
            currentPassword: PASSWORD,
            code: changeCode,
            newPassword: NEXT_PASSWORD,
          },
          { tokenKey: TOKEN_KEY, now: changeAt },
        ),
      ).toBe(true);
      expect(resolveSessionTenant(fixture.client.db, firstSession.token, changeAt)).toBeNull();
      expect(
        await authenticateAccount(fixture.client.db, {
          username: "owner_name",
          password: NEXT_PASSWORD,
        }),
      ).toEqual({ userId: created.tenant.userId, signupComplete: true });

      expect(
        await resetPasswordWithTotp(
          fixture.client.db,
          {
            username: "owner_name",
            code: changeCode,
            password: RESET_PASSWORD,
          },
          { tokenKey: TOKEN_KEY, now: changeAt },
        ),
      ).toBe(false);

      const secondSession = startSession(fixture.client.db, created.tenant.userId, {
        now: changeAt,
      });
      const resetAt = new Date(changeAt.getTime() + 30_000);
      const resetCode = generateTotpCode(setup!.secret, resetAt);
      expect(
        await resetPasswordWithTotp(
          fixture.client.db,
          {
            username: "owner_name",
            code: resetCode,
            password: RESET_PASSWORD,
          },
          { tokenKey: TOKEN_KEY, now: resetAt },
        ),
      ).toBe(true);
      expect(resolveSessionTenant(fixture.client.db, secondSession.token, resetAt)).toBeNull();
      expect(
        await authenticateAccount(fixture.client.db, {
          username: "owner_name",
          password: RESET_PASSWORD,
        }),
      ).toEqual({ userId: created.tenant.userId, signupComplete: true });
    } finally {
      fixture.dispose();
    }
  });

  it("keeps enrollment scoped to the session tenant", async () => {
    const fixture = createTenantTestFixture();
    try {
      expect(
        startTotpEnrollment(fixture.client.db, fixture.tenantA, {
          tokenKey: TOKEN_KEY,
          secretBytes: SECRET_BYTES,
          now: AT,
        }),
      ).not.toBeNull();
      expect(readAccountSecurity(fixture.client.db, fixture.tenantB, TOKEN_KEY)).toMatchObject({
        totpEnabled: false,
        setup: null,
      });
      expect(
        confirmTotpEnrollment(fixture.client.db, fixture.tenantB, "000000", {
          tokenKey: TOKEN_KEY,
          now: AT,
        }),
      ).toBe(false);
    } finally {
      fixture.dispose();
    }
  });
});

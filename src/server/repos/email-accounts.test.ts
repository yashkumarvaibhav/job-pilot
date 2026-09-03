import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { settings } from "../db/schema";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import type { SeededTenantTestFixture } from "../../test/tenant-fixture";
import {
  connectEmailAccount,
  disconnectEmailAccount,
  listEmailAccounts,
  readEmailAccountRefreshToken,
  setDefaultEmailAccount,
} from "./email-accounts";

const TOKEN_KEY = Buffer.alloc(32, 4).toString("base64");

describe("email account repository", () => {
  let fixture: SeededTenantTestFixture;

  beforeEach(() => {
    fixture = createTenantTestFixture();
  });

  afterEach(() => {
    fixture.dispose();
  });

  it("keeps two Google identities independently configured in one workspace", () => {
    const first = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-user-1",
        email: "first@invalid.test",
        refreshToken: "refresh-one",
        senderName: "Primary sender",
        dailyLimit: 40,
        sendingWindowStart: 540,
        sendingWindowEnd: 1020,
        now: new Date("2026-09-03T12:00:00.000Z"),
      },
      TOKEN_KEY,
    );
    const second = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-user-2",
        email: "second@invalid.test",
        refreshToken: "refresh-two",
        senderName: "Second sender",
        replyTo: "replies@invalid.test",
        now: new Date("2026-09-03T12:01:00.000Z"),
      },
      TOKEN_KEY,
    );

    expect(first.id).not.toBe(second.id);
    expect(listEmailAccounts(fixture.client.db, fixture.tenantA)).toEqual([
      expect.objectContaining({
        id: first.id,
        email: "first@invalid.test",
        senderName: "Primary sender",
        dailyLimit: 40,
        sendingWindowStart: 540,
        sendingWindowEnd: 1020,
        status: "connected",
      }),
      expect.objectContaining({
        id: second.id,
        email: "second@invalid.test",
        senderName: "Second sender",
        replyTo: "replies@invalid.test",
        status: "connected",
      }),
    ]);
    expect(JSON.stringify(listEmailAccounts(fixture.client.db, fixture.tenantA))).not.toContain(
      "refresh-one",
    );
    expect(readEmailAccountRefreshToken(
      fixture.client.db,
      fixture.tenantA,
      first.id,
      TOKEN_KEY,
    )).toBe("refresh-one");
    expect(fixture.rowCount("email_account")).toBe(2);
  });

  it("reconnects the same Google subject by updating exactly one account", () => {
    const connected = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "stable-google-sub",
        email: "old-address@invalid.test",
        refreshToken: "old-refresh",
        senderName: "Saved sender",
        signature: "Saved signature",
      },
      TOKEN_KEY,
    );

    const reconnected = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "stable-google-sub",
        email: "new-address@invalid.test",
        refreshToken: "new-refresh",
      },
      TOKEN_KEY,
    );

    expect(reconnected).toMatchObject({
      id: connected.id,
      email: "new-address@invalid.test",
      senderName: "Saved sender",
      signature: "Saved signature",
      status: "connected",
    });
    expect(readEmailAccountRefreshToken(
      fixture.client.db,
      fixture.tenantA,
      connected.id,
      TOKEN_KEY,
    )).toBe("new-refresh");
    expect(fixture.rowCount("email_account")).toBe(1);
  });

  it("allows only a connected account in the same workspace to become default", () => {
    const accountA = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-user-a",
        email: "a@invalid.test",
        refreshToken: "refresh-a",
      },
      TOKEN_KEY,
    );
    const accountB = connectEmailAccount(
      fixture.client.db,
      fixture.tenantB,
      {
        googleSub: "google-user-b",
        email: "b@invalid.test",
        refreshToken: "refresh-b",
      },
      TOKEN_KEY,
    );

    expect(setDefaultEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      accountB.id,
    )).toBe(false);
    expect(setDefaultEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      accountA.id,
    )).toBe(true);

    const saved = fixture.client.db
      .select({ defaultEmailAccountId: settings.defaultEmailAccountId })
      .from(settings)
      .where(eq(settings.workspaceId, fixture.tenantA.workspaceId))
      .get();
    expect(saved?.defaultEmailAccountId).toBe(accountA.id);
  });

  it("treats a foreign account id as missing without writing activity", () => {
    const foreign = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "foreign-google-user",
        email: "foreign@invalid.test",
        refreshToken: "foreign-refresh",
      },
      TOKEN_KEY,
    );
    const beforeEvents = fixture.rowCount("activity_event");

    expect(readEmailAccountRefreshToken(
      fixture.client.db,
      fixture.tenantB,
      foreign.id,
      TOKEN_KEY,
    )).toBeUndefined();
    expect(setDefaultEmailAccount(
      fixture.client.db,
      fixture.tenantB,
      foreign.id,
    )).toBe(false);
    expect(disconnectEmailAccount(
      fixture.client.db,
      fixture.tenantB,
      foreign.id,
    )).toBe(false);
    expect(listEmailAccounts(fixture.client.db, fixture.tenantB)).toEqual([]);
    expect(fixture.rowCount("activity_event")).toBe(beforeEvents);
  });

  it("disconnects one account, clears its default reference and leaves the other", () => {
    const first = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-user-1",
        email: "first@invalid.test",
        refreshToken: "refresh-one",
      },
      TOKEN_KEY,
    );
    const second = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-user-2",
        email: "second@invalid.test",
        refreshToken: "refresh-two",
      },
      TOKEN_KEY,
    );
    setDefaultEmailAccount(fixture.client.db, fixture.tenantA, first.id);

    expect(disconnectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      first.id,
    )).toBe(true);
    expect(listEmailAccounts(fixture.client.db, fixture.tenantA)).toEqual([
      expect.objectContaining({ id: second.id, email: "second@invalid.test" }),
    ]);
    expect(readEmailAccountRefreshToken(
      fixture.client.db,
      fixture.tenantA,
      first.id,
      TOKEN_KEY,
    )).toBeUndefined();
    const saved = fixture.client.db
      .select({ defaultEmailAccountId: settings.defaultEmailAccountId })
      .from(settings)
      .where(eq(settings.workspaceId, fixture.tenantA.workspaceId))
      .get();
    expect(saved?.defaultEmailAccountId).toBeNull();
  });
});

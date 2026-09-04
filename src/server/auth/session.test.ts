import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import {
  resolveEnrollmentSessionTenant,
  resolveSessionTenant,
  revokeAllSessionsForUser,
  revokeSession,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SESSION_TOUCH_INTERVAL_MS,
  sessionCookieAttributes,
  sessionCookieIsSecure,
  startSession,
  touchSession,
} from "./session";

const START = new Date("2026-08-31T10:00:00.000Z");

function at(offsetMs: number): Date {
  return new Date(START.getTime() + offsetMs);
}

describe("startSession", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  it("stores only the digest of a 256-bit opaque token", () => {
    const fixture = newFixture();

    const session = startSession(fixture.client.db, fixture.tenantA.userId, {
      now: START,
    });

    expect(Buffer.from(session.token, "base64url")).toHaveLength(32);

    const row = fixture.client.sqlite
      .prepare("select * from auth_session")
      .get() as Record<string, unknown>;

    expect(row.token_digest).toBe(
      createHash("sha256").update(session.token).digest("hex"),
    );
    expect(JSON.stringify(row)).not.toContain(session.token);
    expect(row.idle_expires_at).toBe(START.getTime() + SESSION_IDLE_MS);
    expect(row.absolute_expires_at).toBe(START.getTime() + SESSION_ABSOLUTE_MS);
    expect(row.revoked_at).toBeNull();
  });

  it("rotates the presented session instead of accumulating rows", () => {
    const fixture = newFixture();
    const first = startSession(fixture.client.db, fixture.tenantA.userId, {
      now: START,
    });

    const second = startSession(fixture.client.db, fixture.tenantA.userId, {
      previousToken: first.token,
      now: at(1_000),
    });

    expect(second.token).not.toBe(first.token);
    expect(
      resolveSessionTenant(fixture.client.db, first.token, at(2_000)),
    ).toBeNull();
    expect(
      resolveSessionTenant(fixture.client.db, second.token, at(2_000)),
    ).toEqual(fixture.tenantA);
  });

  it("leaves another device's session alone", () => {
    const fixture = newFixture();
    const phone = startSession(fixture.client.db, fixture.tenantA.userId, {
      now: START,
    });

    startSession(fixture.client.db, fixture.tenantA.userId, {
      now: at(1_000),
    });

    expect(
      resolveSessionTenant(fixture.client.db, phone.token, at(2_000)),
    ).toEqual(fixture.tenantA);
  });
});

describe("resolveSessionTenant", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  it("derives the workspace from the row, never from the caller", () => {
    const fixture = newFixture();
    const session = startSession(fixture.client.db, fixture.tenantA.userId, {
      now: START,
    });

    expect(resolveSessionTenant(fixture.client.db, session.token, START)).toEqual(
      fixture.tenantA,
    );
  });

  it("gives each account only its own workspace", () => {
    const fixture = newFixture();
    const a = startSession(fixture.client.db, fixture.tenantA.userId, {
      now: START,
    });
    const b = startSession(fixture.client.db, fixture.tenantB.userId, {
      now: START,
    });

    const resolvedA = resolveSessionTenant(fixture.client.db, a.token, START);
    const resolvedB = resolveSessionTenant(fixture.client.db, b.token, START);

    expect(resolvedA).toEqual(fixture.tenantA);
    expect(resolvedB).toEqual(fixture.tenantB);
    expect(resolvedA?.workspaceId).not.toBe(resolvedB?.workspaceId);
  });

  it("keeps an incomplete signup out of ordinary tenant authority", () => {
    const fixture = newFixture();
    fixture.client.sqlite
      .prepare("update user_account set signup_completed_at = null where id = ?")
      .run(fixture.tenantA.userId);
    const session = startSession(fixture.client.db, fixture.tenantA.userId, {
      now: START,
    });

    expect(resolveSessionTenant(fixture.client.db, session.token, START)).toBeNull();
    expect(
      resolveEnrollmentSessionTenant(fixture.client.db, session.token, START),
    ).toEqual(fixture.tenantA);
  });

  it("rejects an unknown, empty or expired token", () => {
    const fixture = newFixture();
    const session = startSession(fixture.client.db, fixture.tenantA.userId, {
      now: START,
    });

    expect(resolveSessionTenant(fixture.client.db, "", START)).toBeNull();
    expect(
      resolveSessionTenant(fixture.client.db, "not-a-real-token", START),
    ).toBeNull();
    expect(
      resolveSessionTenant(fixture.client.db, session.token, at(SESSION_IDLE_MS)),
    ).toBeNull();
    expect(
      resolveSessionTenant(
        fixture.client.db,
        session.token,
        at(SESSION_ABSOLUTE_MS),
      ),
    ).toBeNull();
  });
});

describe("revokeSession", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
  });

  it("makes the token unusable and is safe to repeat", () => {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    const session = startSession(fixture.client.db, fixture.tenantA.userId, {
      now: START,
    });

    expect(revokeSession(fixture.client.db, session.token, at(1_000))).toBe(true);
    expect(
      resolveSessionTenant(fixture.client.db, session.token, at(2_000)),
    ).toBeNull();
    expect(revokeSession(fixture.client.db, session.token, at(3_000))).toBe(
      false,
    );
    expect(revokeSession(fixture.client.db, "", at(3_000))).toBe(false);
  });
});

describe("sessionCookieIsSecure", () => {
  it("is on in production TLS and off on loopback HTTP", () => {
    expect(sessionCookieIsSecure("production")).toBe(true);
    expect(sessionCookieIsSecure("development")).toBe(false);
    expect(sessionCookieIsSecure("test")).toBe(false);
    expect(sessionCookieIsSecure(undefined)).toBe(false);
    expect(
      sessionCookieIsSecure("production", { host: "127.0.0.1:8061" }),
    ).toBe(false);
    expect(
      sessionCookieIsSecure("production", { host: "localhost:8061" }),
    ).toBe(false);
    expect(
      sessionCookieIsSecure("production", {
        host: "127.0.0.1:8061",
        proto: "https",
      }),
    ).toBe(true);
    expect(
      sessionCookieIsSecure("production", {
        host: "jobpilot.yashkumarvaibhav.me",
        proto: "https",
      }),
    ).toBe(true);
    expect(sessionCookieIsSecure("production", { proto: "http" })).toBe(false);
  });
});

describe("sessionCookieAttributes", () => {
  it("is opaque, HttpOnly, Lax and Secure only in production", () => {
    expect(sessionCookieAttributes({ secure: false, expires: START })).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
      expires: START,
    });
    expect(sessionCookieAttributes({ secure: true, expires: START }).secure).toBe(
      true,
    );
  });
});

describe("touchSession", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  function sessionRow(fixture: ReturnType<typeof createTenantTestFixture>) {
    return fixture.client.sqlite
      .prepare(
        "select last_seen_at, idle_expires_at, absolute_expires_at from auth_session",
      )
      .get() as {
      last_seen_at: number;
      idle_expires_at: number;
      absolute_expires_at: number;
    };
  }

  it("slides the idle window forward for a session still in use", () => {
    const fixture = newFixture();
    const session = startSession(fixture.client.db, fixture.tenantA.userId, {
      now: START,
    });
    const before = sessionRow(fixture);

    const later = at(SESSION_IDLE_MS - 1_000);
    expect(touchSession(fixture.client.db, session.token, later)).toBe(true);

    const after = sessionRow(fixture);
    expect(after.last_seen_at).toBeGreaterThan(before.last_seen_at);
    expect(after.idle_expires_at).toBeGreaterThan(before.idle_expires_at);

    // Still alive well past the original idle deadline because it was used.
    expect(
      resolveSessionTenant(
        fixture.client.db,
        session.token,
        at(SESSION_IDLE_MS + 1_000),
      ),
    ).not.toBeNull();
  });

  it("never slides past the absolute lifetime, however active the session is", () => {
    const fixture = newFixture();
    const session = startSession(fixture.client.db, fixture.tenantA.userId, {
      now: START,
    });

    // Use it right up to the last moment before the absolute deadline.
    touchSession(fixture.client.db, session.token, at(SESSION_ABSOLUTE_MS - 1_000));

    const row = sessionRow(fixture);
    expect(row.idle_expires_at).toBeLessThanOrEqual(row.absolute_expires_at);
    expect(
      resolveSessionTenant(
        fixture.client.db,
        session.token,
        at(SESSION_ABSOLUTE_MS + 1),
      ),
    ).toBeNull();
  });

  it("writes at most once per interval so an ordinary page load is a read", () => {
    const fixture = newFixture();
    const session = startSession(fixture.client.db, fixture.tenantA.userId, {
      now: START,
    });

    expect(touchSession(fixture.client.db, session.token, at(60_000))).toBe(
      false,
    );
    expect(sessionRow(fixture).last_seen_at).toBe(START.getTime());

    expect(
      touchSession(
        fixture.client.db,
        session.token,
        at(SESSION_TOUCH_INTERVAL_MS + 1_000),
      ),
    ).toBe(true);
  });

  it("does not resurrect an expired or revoked session", () => {
    const fixture = newFixture();
    const session = startSession(fixture.client.db, fixture.tenantA.userId, {
      now: START,
    });
    revokeSession(fixture.client.db, session.token, at(1_000));

    expect(
      touchSession(fixture.client.db, session.token, at(2 * SESSION_TOUCH_INTERVAL_MS)),
    ).toBe(false);
    expect(
      resolveSessionTenant(fixture.client.db, session.token, at(3_000)),
    ).toBeNull();

    const expired = startSession(fixture.client.db, fixture.tenantB.userId, {
      now: START,
    });
    expect(
      touchSession(fixture.client.db, expired.token, at(SESSION_IDLE_MS + 1)),
    ).toBe(false);
  });
});

describe("revokeAllSessionsForUser", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  it("signs every device out and leaves other accounts alone", () => {
    const fixture = newFixture();
    const laptop = startSession(fixture.client.db, fixture.tenantA.userId, {
      now: START,
    });
    const phone = startSession(fixture.client.db, fixture.tenantA.userId, {
      now: START,
    });
    const other = startSession(fixture.client.db, fixture.tenantB.userId, {
      now: START,
    });

    expect(
      revokeAllSessionsForUser(
        fixture.client.db,
        fixture.tenantA.userId,
        at(1_000),
      ),
    ).toBe(2);

    expect(resolveSessionTenant(fixture.client.db, laptop.token, at(2_000))).toBeNull();
    expect(resolveSessionTenant(fixture.client.db, phone.token, at(2_000))).toBeNull();
    expect(
      resolveSessionTenant(fixture.client.db, other.token, at(2_000)),
    ).not.toBeNull();
  });

  it("can keep the session doing the revoking, for a password change in place", () => {
    const fixture = newFixture();
    const laptop = startSession(fixture.client.db, fixture.tenantA.userId, {
      now: START,
    });
    const phone = startSession(fixture.client.db, fixture.tenantA.userId, {
      now: START,
    });

    expect(
      revokeAllSessionsForUser(fixture.client.db, fixture.tenantA.userId, at(1_000), {
        exceptToken: laptop.token,
      }),
    ).toBe(1);

    expect(
      resolveSessionTenant(fixture.client.db, laptop.token, at(2_000)),
    ).not.toBeNull();
    expect(resolveSessionTenant(fixture.client.db, phone.token, at(2_000))).toBeNull();
  });
});

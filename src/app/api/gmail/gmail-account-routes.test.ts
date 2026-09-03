import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../../../test/tenant-fixture";
import {
  connectEmailAccount,
  listEmailAccounts,
} from "../../../server/repos/email-accounts";

const TOKEN_KEY = Buffer.alloc(32, 6).toString("base64");

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: undefined as unknown,
  revoke: vi.fn(),
}));

vi.mock("@/server/auth/current-session", () => ({
  currentTenant: async () => mocks.tenant,
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));
vi.mock("@/server/mail/google-revoke", () => ({
  revokeGoogleRefreshToken: mocks.revoke,
}));

import { GET as list } from "./accounts/route";
import { PATCH as update } from "./[id]/route";
import { POST as setDefault } from "./[id]/default/route";
import { POST as disconnect } from "./[id]/disconnect/route";

const ORIGIN = "https://jobpilot.invalid.test";

function patchAccount(id: string, body: unknown) {
  return update(
    new Request(`${ORIGIN}/api/gmail/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("Gmail account routes", () => {
  const fixtures: { dispose: () => void }[] = [];

  beforeEach(() => {
    vi.stubEnv("TOKEN_KEY", TOKEN_KEY);
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
    mocks.revoke.mockReset();
    mocks.revoke.mockResolvedValue(true);
  });

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
    vi.unstubAllEnvs();
  });

  it("requires a session for every operation", async () => {
    mocks.tenant = null;
    const context = { params: Promise.resolve({ id: "anything" }) };

    expect((await list()).status).toBe(401);
    expect((await patchAccount("anything", { senderName: "x" })).status).toBe(401);
    expect((await setDefault(new Request(`${ORIGIN}/d`), context)).status).toBe(401);
    expect((await disconnect(new Request(`${ORIGIN}/x`), context)).status).toBe(401);
  });

  it("lists safe account fields and updates one account's settings", async () => {
    const fixture = fixtures[0] as ReturnType<typeof createTenantTestFixture>;
    const account = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "private-google-sub",
        email: "owner@invalid.test",
        refreshToken: "private-refresh",
      },
      TOKEN_KEY,
    );

    const listed = await list();
    expect(listed.status).toBe(200);
    const listedText = await listed.text();
    expect(listedText).toContain("owner@invalid.test");
    expect(listedText).not.toContain("private-refresh");
    expect(listedText).not.toContain("private-google-sub");

    const saved = await patchAccount(account.id, {
      senderName: "Career sender",
      signature: "Regards",
      replyTo: "reply@invalid.test",
      dailyLimit: 30,
      sendingWindowStart: 480,
      sendingWindowEnd: 1140,
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toEqual(
      expect.objectContaining({
        senderName: "Career sender",
        signature: "Regards",
        dailyLimit: 30,
      }),
    );
  });

  it("gives foreign ids a 404 without revocation or activity", async () => {
    const fixture = fixtures[0] as ReturnType<typeof createTenantTestFixture>;
    const foreign = connectEmailAccount(
      fixture.client.db,
      fixture.tenantB,
      {
        googleSub: "foreign-google-sub",
        email: "foreign@invalid.test",
        refreshToken: "foreign-refresh",
      },
      TOKEN_KEY,
    );
    const beforeEvents = fixture.rowCount("activity_event");
    const context = { params: Promise.resolve({ id: foreign.id }) };

    expect((await patchAccount(foreign.id, { senderName: "stolen" })).status).toBe(404);
    expect((await setDefault(new Request(`${ORIGIN}/d`), context)).status).toBe(404);
    expect((await disconnect(new Request(`${ORIGIN}/x`), context)).status).toBe(404);
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(fixture.rowCount("activity_event")).toBe(beforeEvents);
  });

  it("sets a default and revokes then disconnects only the selected account", async () => {
    const fixture = fixtures[0] as ReturnType<typeof createTenantTestFixture>;
    const first = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-one",
        email: "one@invalid.test",
        refreshToken: "refresh-one",
      },
      TOKEN_KEY,
    );
    const second = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-two",
        email: "two@invalid.test",
        refreshToken: "refresh-two",
      },
      TOKEN_KEY,
    );

    const context = { params: Promise.resolve({ id: first.id }) };
    expect((await setDefault(new Request(`${ORIGIN}/d`), context)).status).toBe(200);
    expect((await disconnect(new Request(`${ORIGIN}/x`), context)).status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith("refresh-one");
    expect(listEmailAccounts(fixture.client.db, fixture.tenantA)).toEqual([
      expect.objectContaining({ id: second.id, email: "two@invalid.test" }),
    ]);
  });
});

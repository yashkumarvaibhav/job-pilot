import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DIGEST_SUBJECT } from "../../../../domain/digest";
import { createTenantTestFixture } from "../../../../test/tenant-fixture";
import { connectEmailAccount } from "../../../../server/repos/email-accounts";
import { readDigestPolicy } from "../../../../server/repos/digest";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: undefined as unknown,
}));

vi.mock("@/server/auth/current-session", () => ({
  currentTenant: async () => mocks.tenant,
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));

import { GET as getPolicy, PATCH } from "./route";
import { GET as getPreview } from "./preview/route";

const ORIGIN = "https://jobpilot.invalid.test";
const TOKEN_KEY = Buffer.alloc(32, 21).toString("base64");

function patch(body: unknown) {
  return PATCH(
    new Request(`${ORIGIN}/api/settings/digest`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("digest settings routes", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  beforeEach(() => {
    mocks.database = undefined;
    mocks.tenant = undefined;
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
    return fixture;
  }

  it("refuses both verbs without a session", async () => {
    newFixture();
    mocks.tenant = null;
    expect((await getPolicy()).status).toBe(401);
    expect((await getPreview()).status).toBe(401);
    expect((await patch({ digestEmailEnabled: true })).status).toBe(401);
  });

  it("returns the default policy and a Today-matching preview", async () => {
    newFixture();
    expect((await getPolicy()).status).toBe(200);
    await expect((await getPolicy()).json()).resolves.toMatchObject({
      digestEmailEnabled: false,
      digestAccountId: null,
      digestHour: null,
    });
    const preview = await getPreview();
    expect(preview.status).toBe(200);
    const body = (await preview.json()) as { body: string; counts: object };
    expect(body.body.startsWith("TODAY")).toBe(true);
    expect(body.counts).toMatchObject({
      followUps: 0,
      deadlines: 0,
      oa: 0,
      replies: 0,
      interviewsToday: 0,
    });
  });

  it("saves one connected account and refuses a workspace-scoped foreign id", async () => {
    const fixture = newFixture();
    const account = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-a",
        email: "owner-a@invalid.test",
        refreshToken: "refresh-a",
      },
      TOKEN_KEY,
    );
    const foreign = connectEmailAccount(
      fixture.client.db,
      fixture.tenantB,
      {
        googleSub: "google-b",
        email: "owner-b@invalid.test",
        refreshToken: "refresh-b",
      },
      TOKEN_KEY,
    );

    const saved = await patch({
      digestHour: 8,
      digestAccountId: account.id,
      digestEmailEnabled: true,
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      digestHour: 8,
      digestEmailEnabled: true,
      digestAccountId: account.id,
      digestAccountEmail: "owner-a@invalid.test",
    });

    expect(
      (await patch({
        digestAccountId: foreign.id,
        digestEmailEnabled: true,
      })).status,
    ).toBe(400);
    expect(readDigestPolicy(fixture.client.db, fixture.tenantB).digestEmailEnabled).toBe(
      false,
    );
  });

  it("rejects a body that names a workspace", async () => {
    const fixture = newFixture();
    expect(
      (
        await patch({
          digestEmailEnabled: true,
          workspaceId: fixture.tenantB.workspaceId,
        })
      ).status,
    ).toBe(400);
  });

  it("does not mention a live subject until a digest is actually queued", async () => {
    newFixture();
    const preview = (await (await getPreview()).json()) as { body: string };
    expect(preview.body).not.toContain(DIGEST_SUBJECT);
  });
});

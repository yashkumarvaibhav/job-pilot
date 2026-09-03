import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readWorkspaceSettings } from "../../../server/repos/settings";
import { createTenantTestFixture } from "../../../test/tenant-fixture";
import { DEFAULT_SCORING_WEIGHTS } from "../../../domain/scoring";

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

import { GET, PATCH } from "./route";

const URL_SETTINGS = "https://jobpilot.invalid.test/api/settings";

function patch(body: unknown) {
  return PATCH(
    new Request(URL_SETTINGS, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("settings route handlers", () => {
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
    const fixture = newFixture();
    mocks.tenant = null;

    expect((await GET()).status).toBe(401);
    expect((await patch({ displayName: "Impostor" })).status).toBe(401);
    expect(readWorkspaceSettings(fixture.client.db, fixture.tenantA).displayName).toBe(
      "Tenant A",
    );
  });

  it("returns the signed-in workspace's settings as clock strings", async () => {
    newFixture();

    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      displayName: "Tenant A",
      university: null,
      timezone: "Asia/Kolkata",
      quietStart: null,
      quietEnd: null,
      scoringWeights: DEFAULT_SCORING_WEIGHTS,
    });
  });

  it("saves a profile, a zone and quiet hours", async () => {
    newFixture();

    const response = await patch({
      displayName: "Yash Kumar Vaibhav",
      university: "IIIT Delhi",
      timezone: "America/New_York",
      quietStart: "23:30",
      quietEnd: "08:00",
      scoringWeights: { targetCompany: 0, newGradRole: 7 },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      displayName: "Yash Kumar Vaibhav",
      university: "IIIT Delhi",
      timezone: "America/New_York",
      quietStart: "23:30",
      quietEnd: "08:00",
      scoringWeights: {
        ...DEFAULT_SCORING_WEIGHTS,
        targetCompany: 0,
        newGradRole: 7,
      },
    });
  });

  it("rejects a body that names a workspace instead of trusting the session", async () => {
    const fixture = newFixture();

    const response = await patch({
      displayName: "Impostor",
      workspaceId: fixture.tenantB.workspaceId,
    });

    expect(response.status).toBe(400);
    expect(readWorkspaceSettings(fixture.client.db, fixture.tenantB).displayName).toBe(
      "Tenant B",
    );
    expect(readWorkspaceSettings(fixture.client.db, fixture.tenantA).displayName).toBe(
      "Tenant A",
    );
  });

  it("explains a bad zone, a half-set window and a missing name", async () => {
    newFixture();

    for (const body of [
      { displayName: "Tenant A", timezone: "Mars/Olympus_Mons" },
      { displayName: "Tenant A", quietStart: "23:30", quietEnd: "" },
      { displayName: "Tenant A", quietStart: "11:30 PM", quietEnd: "08:00" },
      { displayName: "   " },
      { displayName: "Tenant A", scoringWeights: { hiddenTerm: 20 } },
      { displayName: "Tenant A", scoringWeights: { targetCompany: 1.5 } },
    ]) {
      const response = await patch(body);
      expect(response.status).toBe(400);
      const payload = (await response.json()) as { error: string };
      expect(payload.error.length).toBeGreaterThan(0);
    }
  });

  it("rejects a non-JSON body and a non-string field", async () => {
    newFixture();

    const notJson = await PATCH(
      new Request(URL_SETTINGS, { method: "PATCH", body: "displayName=x" }),
    );
    expect(notJson.status).toBe(400);

    expect((await patch({ displayName: 42 })).status).toBe(400);
    expect((await patch({ displayName: "Tenant A", quietStart: 1410 })).status).toBe(
      400,
    );
    expect(
      (await patch({ displayName: "Tenant A", scoringWeights: "heavy" })).status,
    ).toBe(400);
  });
});

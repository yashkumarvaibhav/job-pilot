import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTOMATION_RULES } from "../../../domain/rules";
import { createTenantTestFixture } from "../../../test/tenant-fixture";
import { listAutomationRules } from "../../../server/repos/rules";

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

const URL = "https://jobpilot.invalid.test/api/automation-rules";

describe("automation rule route handlers", () => {
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

  it("lists the signed-in workspace catalog", async () => {
    newFixture();
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rules: { slug: string; enabled: boolean }[];
    };
    expect(body.rules.map((rule) => rule.slug)).toEqual(
      AUTOMATION_RULES.map((rule) => rule.slug),
    );
    expect(body.rules.every((rule) => rule.enabled)).toBe(true);
  });

  it("refuses an unauthenticated toggle", async () => {
    mocks.tenant = null;
    const response = await PATCH(
      new Request(URL, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "stale_opportunity_no_activity",
          enabled: false,
        }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("toggles a slug for A without changing B", async () => {
    const fixture = newFixture();
    const response = await PATCH(
      new Request(URL, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "stale_opportunity_no_activity",
          enabled: false,
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(
      listAutomationRules(fixture.client.db, fixture.tenantA).find(
        (rule) => rule.slug === "stale_opportunity_no_activity",
      )?.enabled,
    ).toBe(false);
    expect(
      listAutomationRules(fixture.client.db, fixture.tenantB).find(
        (rule) => rule.slug === "stale_opportunity_no_activity",
      )?.enabled,
    ).toBe(true);
  });

  it("rejects a workspaceId field and an unknown slug", async () => {
    newFixture();
    const smuggled = await PATCH(
      new Request(URL, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "stale_opportunity_no_activity",
          enabled: false,
          workspaceId: "workspace-b",
        }),
      }),
    );
    expect(smuggled.status).toBe(400);

    const unknown = await PATCH(
      new Request(URL, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: "cancel_on_reply",
          enabled: false,
        }),
      }),
    );
    expect(unknown.status).toBe(400);
  });
});

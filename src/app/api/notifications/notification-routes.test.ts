import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calendarDateInZone } from "../../../domain/referral";
import { createContact } from "../../../server/repos/contacts";
import { createTenantTestFixture } from "../../../test/tenant-fixture";

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

import { GET } from "./route";
import { POST as materialize } from "./materialize/route";
import { POST as snooze } from "./snooze/route";

describe("notification route handlers", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
    return fixture;
  }

  beforeEach(() => {
    mocks.database = undefined;
    mocks.tenant = undefined;
  });

  const nowOn = () => calendarDateInZone("Asia/Kolkata");

  it("lists without writing and rejects prefetch materialisation", async () => {
    const fixture = newFixture();
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      followUpOn: nowOn(),
    });

    const listed = await GET(
      new Request("https://jobpilot.invalid.test/api/notifications"),
    );
    expect(listed.status).toBe(200);
    expect(fixture.rowCount("notification")).toBe(0);

    const blocked = await materialize(
      new Request("https://jobpilot.invalid.test/api/notifications/materialize", {
        method: "POST",
        headers: { "next-router-prefetch": "1" },
      }),
    );
    expect(blocked.status).toBe(403);
    expect(fixture.rowCount("notification")).toBe(0);

    const created = await materialize(
      new Request("https://jobpilot.invalid.test/api/notifications/materialize", {
        method: "POST",
      }),
    );
    expect(created.status).toBe(200);
    expect(fixture.rowCount("notification")).toBe(1);

    const again = await GET(
      new Request("https://jobpilot.invalid.test/api/notifications"),
    );
    const body = (await again.json()) as {
      items: Array<Record<string, unknown>>;
    };
    expect(body.items[0]).not.toHaveProperty("workspaceId");
    expect(JSON.stringify(body)).toContain("Rahul Sharma");
  });

  it("returns 404 when snoozing another workspace's row", async () => {
    const fixture = newFixture();
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul-a",
      name: "Rahul Sharma",
      followUpOn: nowOn(),
    });
    mocks.tenant = fixture.tenantB;
    await materialize(
      new Request("https://jobpilot.invalid.test/api/notifications/materialize", {
        method: "POST",
      }),
    );
    mocks.tenant = fixture.tenantA;
    await materialize(
      new Request("https://jobpilot.invalid.test/api/notifications/materialize", {
        method: "POST",
      }),
    );
    const listed = await GET(
      new Request("https://jobpilot.invalid.test/api/notifications?tab=all"),
    );
    const body = (await listed.json()) as {
      items: Array<{ id: string }>;
    };
    mocks.tenant = fixture.tenantB;
    const response = await snooze(
      new Request("https://jobpilot.invalid.test/api/notifications/snooze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [body.items[0]!.id], preset: "3h" }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects an unauthenticated list", async () => {
    mocks.tenant = undefined;
    const response = await GET(
      new Request("https://jobpilot.invalid.test/api/notifications"),
    );
    expect(response.status).toBe(401);
  });
});

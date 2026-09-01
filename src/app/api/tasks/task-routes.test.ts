import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dueSourceKey } from "../../../domain/due-source";
import { createContact, updateContact } from "../../../server/repos/contacts";
import { createTask } from "../../../server/repos/tasks";
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

import { GET as listRoute, POST } from "./route";
import { GET as detailRoute } from "./[id]/route";
import { POST as completeRoute } from "./[id]/complete/route";
import { POST as convertRoute } from "./from-derived/route";

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("task route handlers", () => {
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

  it("creates, lists, completes, and hides workspace ids", async () => {
    newFixture();
    const createdResponse = await POST(
      jsonRequest("http://localhost/api/tasks", "POST", {
        title: "Prepare system design",
        dueOn: "2026-09-07",
      }),
    );
    const created = (await createdResponse.json()) as Record<string, unknown>;
    expect(createdResponse.status).toBe(201);
    expect(created).toMatchObject({
      title: "Prepare system design",
      dueOn: "2026-09-07",
      status: "open",
    });
    expect(created).not.toHaveProperty("workspaceId");

    const listed = await listRoute(
      jsonRequest("http://localhost/api/tasks", "GET"),
    );
    expect(await listed.json()).toEqual([
      expect.objectContaining({ title: "Prepare system design" }),
    ]);

    const completedResponse = await completeRoute(
      jsonRequest(
        `http://localhost/api/tasks/${created.id}/complete`,
        "POST",
      ),
      { params: Promise.resolve({ id: String(created.id) }) },
    );
    expect(completedResponse.status).toBe(200);
    const after = await listRoute(
      jsonRequest("http://localhost/api/tasks", "GET"),
    );
    expect(await after.json()).toEqual([]);
    const completed = await listRoute(
      jsonRequest("http://localhost/api/tasks?status=completed", "GET"),
    );
    expect(await completed.json()).toEqual([
      expect.objectContaining({ status: "completed" }),
    ]);
  });

  it("converts a derived contact next action without leaking tenant B", async () => {
    const fixture = newFixture();
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
    });
    updateContact(fixture.client.db, fixture.tenantA, "rahul", {
      nextAction: "Follow up about Microsoft openings",
      followUpOn: "2026-09-02",
    });
    createContact(fixture.client.db, fixture.tenantB, {
      id: "hidden",
      name: "Hidden Person",
    });
    updateContact(fixture.client.db, fixture.tenantB, "hidden", {
      nextAction: "Follow up about Microsoft openings",
      followUpOn: "2026-09-02",
    });
    createTask(fixture.client.db, fixture.tenantB, {
      id: "task-b",
      title: "Secret",
    });

    const converted = await convertRoute(
      jsonRequest("http://localhost/api/tasks/from-derived", "POST", {
        sourceKey: dueSourceKey("contact_next_action", "rahul"),
      }),
    );
    expect(converted.status).toBe(201);
    const body = (await converted.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      title: "Follow up about Microsoft openings",
      derivedFromKey: dueSourceKey("contact_next_action", "rahul"),
    });

    mocks.tenant = fixture.tenantB;
    const foreign = await detailRoute(
      jsonRequest(`http://localhost/api/tasks/${body.id}`, "GET"),
      { params: Promise.resolve({ id: String(body.id) }) },
    );
    expect(foreign.status).toBe(404);
    const listed = await listRoute(
      jsonRequest("http://localhost/api/tasks", "GET"),
    );
    expect(await listed.json()).toEqual([
      expect.objectContaining({ title: "Secret" }),
    ]);
  });
});

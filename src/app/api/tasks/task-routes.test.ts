import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dueSourceKey } from "../../../domain/due-source";
import { calendarDateInZone } from "../../../domain/referral";
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
import {
  DELETE as deleteRoute,
  GET as detailRoute,
  PATCH as updateRoute,
} from "./[id]/route";
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

    const reopenedResponse = await updateRoute(
      jsonRequest(`http://localhost/api/tasks/${created.id}`, "PATCH", {
        status: "open",
      }),
      { params: Promise.resolve({ id: String(created.id) }) },
    );
    expect(reopenedResponse.status).toBe(200);
    expect(await reopenedResponse.json()).toMatchObject({
      status: "open",
      completedAt: null,
    });

    const deletedResponse = await deleteRoute(
      jsonRequest(`http://localhost/api/tasks/${created.id}`, "DELETE"),
      { params: Promise.resolve({ id: String(created.id) }) },
    );
    expect(deletedResponse.status).toBe(204);
    const empty = await listRoute(
      jsonRequest("http://localhost/api/tasks", "GET"),
    );
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);
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

  it("lists Today's due items on source=followups without leaking tenant B", async () => {
    const fixture = newFixture();
    const asOfA = calendarDateInZone("Asia/Kolkata");
    const asOfB = calendarDateInZone("America/New_York");
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      name: "Priya Nair",
      networkingStatus: "waiting_for_reply",
      followUpOn: asOfA,
    });
    createContact(fixture.client.db, fixture.tenantB, {
      id: "b-priya",
      name: "Hidden Priya",
      networkingStatus: "waiting_for_reply",
      followUpOn: asOfB,
    });

    const listed = await listRoute(
      jsonRequest("http://localhost/api/tasks?source=followups", "GET"),
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as Array<Record<string, unknown>>;
    expect(body).toEqual([
      expect.objectContaining({
        sourceKey: dueSourceKey("contact_next_action", "priya"),
        origin: "derived",
        title: "Follow up",
        entityLabel: "Priya Nair",
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain("Hidden Priya");
    expect(JSON.stringify(body)).not.toContain("workspace");

    mocks.tenant = fixture.tenantB;
    const foreign = await listRoute(
      jsonRequest("http://localhost/api/tasks?source=followups", "GET"),
    );
    expect(await foreign.json()).toEqual([
      expect.objectContaining({
        entityLabel: "Hidden Priya",
        sourceKey: dueSourceKey("contact_next_action", "b-priya"),
      }),
    ]);
  });

  it("does not let one workspace delete another workspace's task", async () => {
    const fixture = newFixture();
    createTask(fixture.client.db, fixture.tenantB, {
      id: "private-task",
      title: "Private task",
    });
    const before = fixture.rowCount("activity_event");

    const response = await deleteRoute(
      jsonRequest("http://localhost/api/tasks/private-task", "DELETE"),
      { params: Promise.resolve({ id: "private-task" }) },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Task not found" });
    expect(fixture.rowCount("activity_event")).toBe(before);
  });
});

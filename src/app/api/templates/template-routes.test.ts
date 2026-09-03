import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../../../test/tenant-fixture";
import { createEmailTemplate } from "../../../server/repos/email-content";

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

import { GET, POST } from "./route";
import { DELETE, PATCH } from "./[id]/route";

const ORIGIN = "https://jobpilot.invalid.test";
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonRequest = (path: string, method: string, body: unknown) =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("template routes", () => {
  const fixtures: { dispose: () => void }[] = [];

  beforeEach(() => {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
  });

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  it("requires authentication", async () => {
    mocks.tenant = null;
    expect((await GET()).status).toBe(401);
    expect((await POST(jsonRequest("/api/templates", "POST", {}))).status).toBe(401);
    expect((await PATCH(jsonRequest("/api/templates/x", "PATCH", {}), context("x"))).status).toBe(401);
    expect((await DELETE(new Request(`${ORIGIN}/api/templates/x`, { method: "DELETE" }), context("x"))).status).toBe(401);
  });

  it("lists the idempotently seeded §16 shells and creates a custom template", async () => {
    const listed = await GET();
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { templates: unknown[] }).templates).toHaveLength(13);
    expect(((await (await GET()).json()) as { templates: unknown[] }).templates).toHaveLength(13);

    const created = await POST(
      jsonRequest("/api/templates", "POST", {
        title: "Custom outreach",
        subject: "Hello",
        body: "Owner-written body",
        variables: [],
        defaultEmailAccountId: null,
        defaultDocumentVersionId: null,
        defaultFollowUpDays: null,
        tags: ["Custom"],
      }),
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual(
      expect.objectContaining({ title: "Custom outreach", body: "Owner-written body" }),
    );
  });

  it("updates and deletes only the current workspace template", async () => {
    const fixture = fixtures[0] as ReturnType<typeof createTenantTestFixture>;
    const owned = createEmailTemplate(fixture.client.db, fixture.tenantA, {
      id: "owned",
      title: "Owned",
    });
    const foreign = createEmailTemplate(fixture.client.db, fixture.tenantB, {
      id: "foreign",
      title: "Foreign",
    });

    expect(
      (
        await PATCH(
          jsonRequest(`/api/templates/${foreign.id}`, "PATCH", { subject: "Stolen" }),
          context(foreign.id),
        )
      ).status,
    ).toBe(404);
    const updated = await PATCH(
      jsonRequest(`/api/templates/${owned.id}`, "PATCH", {
        subject: "Hello {{first_name}}",
        body: "Owner body",
        variables: ["first_name"],
      }),
      context(owned.id),
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual(
      expect.objectContaining({ subject: "Hello {{first_name}}" }),
    );
    expect(
      (
        await DELETE(
          new Request(`${ORIGIN}/api/templates/${owned.id}`, { method: "DELETE" }),
          context(owned.id),
        )
      ).status,
    ).toBe(200);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createContact, updateContact } from "../server/repos/contacts";
import { createTask } from "../server/repos/tasks";
import { createTenantTestFixture } from "../test/tenant-fixture";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: undefined as unknown,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/server/auth/current-session", () => ({
  requireTenant: async () => mocks.tenant,
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));

import Home from "./(app)/page";
import TasksPage from "./(app)/tasks/page";

describe("task screens", () => {
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

  it("names the empty task list and points at Today", async () => {
    newFixture();
    const html = renderToStaticMarkup(
      await TasksPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain(
      "No open tasks. Follow-up dates on contacts also appear on Today.",
    );
    expect(html).toContain("Add task");
  });

  it("lists an open task and hides it from the default filter once completed", async () => {
    const fixture = newFixture();
    createTask(fixture.client.db, fixture.tenantA, {
      id: "task-prep",
      title: "Prepare system design",
      dueOn: "2026-09-07",
    });

    const open = renderToStaticMarkup(
      await TasksPage({ searchParams: Promise.resolve({}) }),
    );
    expect(open).toContain("Prepare system design");
    expect(open).toContain("Complete");
    expect(open).toContain("2026-09-07");
    expect(open).toContain('class="tbl task-table"');
    expect(open).toContain('class="task-card-list"');

    const { completeTask } = await import("../server/repos/tasks");
    completeTask(fixture.client.db, fixture.tenantA, "task-prep");
    const after = renderToStaticMarkup(
      await TasksPage({ searchParams: Promise.resolve({}) }),
    );
    expect(after).toContain("No open tasks. Follow-up dates on contacts also appear on Today.");
    expect(after).not.toContain("Prepare system design");

    const completed = renderToStaticMarkup(
      await TasksPage({
        searchParams: Promise.resolve({ status: "completed" }),
      }),
    );
    expect(completed).toContain("Prepare system design");
    expect(completed).toContain("Completed");
  });

  it("shows a contact next action and a same-day linked task on Today", async () => {
    const fixture = newFixture();
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
    });
    updateContact(fixture.client.db, fixture.tenantA, "rahul", {
      nextAction: "Follow up about Microsoft openings",
      followUpOn: "2026-09-02",
    });
    createTask(fixture.client.db, fixture.tenantA, {
      id: "task-resume",
      title: "Send resume",
      dueOn: "2026-09-02",
      entityType: "contact",
      entityId: "rahul",
    });

    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("Follow up about Microsoft openings");
    expect(html).toContain("Send resume");
    expect(html).toContain("Create task");
    expect(html).toContain("Rahul Sharma");
    expect(html).toContain('class="tbl task-table"');
    expect(html).toContain('class="task-card-list"');
  });
});

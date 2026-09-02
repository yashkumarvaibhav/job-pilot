import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NOTIFICATION_EMPTY, NOTIFICATION_ERROR } from "../domain/notification";
import { calendarDateInZone } from "../domain/referral";
import { createContact } from "../server/repos/contacts";
import { materializeNotifications } from "../server/repos/notifications";
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

import NotificationsPage from "./(app)/notifications/page";
import NotificationsError from "./(app)/notifications/error";
import NotificationsLoading from "./(app)/notifications/loading";
import Home from "./(app)/(today)/page";

describe("notification screen", () => {
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

  it("names the empty sentence and the six tabs without writing", async () => {
    const fixture = newFixture();
    const html = renderToStaticMarkup(
      await NotificationsPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain(NOTIFICATION_EMPTY);
    expect(html).toContain("Unread");
    expect(html).toContain("Today");
    expect(html).toContain("Upcoming");
    expect(html).toContain("Overdue");
    expect(html).toContain("Muted");
    expect(html).toContain(">All<");
    expect(fixture.rowCount("notification")).toBe(0);
  });

  it("renders a due follow-up with the person and the reason", async () => {
    const fixture = newFixture();
    const asOfOn = calendarDateInZone("Asia/Kolkata");
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      nextAction: "Ask about openings",
      followUpOn: asOfOn,
    });
    materializeNotifications(fixture.client.db, fixture.tenantA);
    const html = renderToStaticMarkup(
      await NotificationsPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("Follow up with Rahul Sharma");
    expect(html).toContain("Ask about openings");
    expect(html).toContain("Snooze 3 hours");
    expect(html).toContain("Mute this type");
    expect(html).toContain("Open");
    expect(html).toContain('class="task-card-list"');
  });

  it("does not write when Today or Notifications are rendered", async () => {
    const fixture = newFixture();
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      followUpOn: calendarDateInZone("Asia/Kolkata"),
    });
    await Home();
    await NotificationsPage({ searchParams: Promise.resolve({}) });
    expect(fixture.rowCount("notification")).toBe(0);
  });

  it("designs loading and error states and stacks cards below 768px", () => {
    expect(renderToStaticMarkup(<NotificationsLoading />)).toContain(
      "Loading notifications",
    );
    expect(
      renderToStaticMarkup(<NotificationsError reset={() => undefined} />),
    ).toContain(NOTIFICATION_ERROR);
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain(".notification-page");
    expect(css).toContain("min-height: var(--target-min)");
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toContain(".task-card-list");
  });
});

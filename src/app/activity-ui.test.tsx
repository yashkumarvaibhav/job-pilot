import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCompany } from "../server/repos/companies";
import { createContact } from "../server/repos/contacts";
import { createOpportunity } from "../server/repos/opportunities";
import { createReferral } from "../server/repos/referrals";
import { createTask } from "../server/repos/tasks";
import { createTenantTestFixture } from "../test/tenant-fixture";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: undefined as unknown,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/settings/activity",
}));
vi.mock("@/server/auth/current-session", () => ({
  requireTenant: async () => mocks.tenant,
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));

import { ActivityTimeline } from "../components/activity-timeline";
import { SettingsNav } from "../components/settings-nav";
import SettingsActivityPage from "./(app)/settings/activity/page";

describe("activity screens", () => {
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

  it("names the empty global feed", () => {
    const html = renderToStaticMarkup(
      <ActivityTimeline
        empty="No activity recorded yet."
        items={[]}
        timeZone="Asia/Kolkata"
        todayOn="2026-09-01"
      />,
    );
    expect(html).toContain("No activity recorded yet.");
  });

  it("lists company, contact, opportunity, referral, and task events", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      companyId: "microsoft",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "microsoft-sde",
      companyId: "microsoft",
      role: "SDE",
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "rahul-referral",
      contactId: "rahul",
      opportunityId: "microsoft-sde",
      channel: "whatsapp",
      stage: "requested",
    });
    createTask(fixture.client.db, fixture.tenantA, {
      id: "prep",
      title: "Prepare system design",
    });

    const html = renderToStaticMarkup(
      await SettingsActivityPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("Company created → Microsoft");
    expect(html).toContain("Contact created → Rahul Sharma");
    expect(html).toContain("Job saved → Microsoft SDE");
    expect(html).toContain("Referral requested → Rahul Sharma");
    expect(html).toContain("Task created → Prepare system design");
    expect(html).not.toContain("No activity recorded yet.");
  });

  it("exposes Activity next to Import in settings navigation", () => {
    const html = renderToStaticMarkup(<SettingsNav />);
    expect(html).toContain("Import");
    expect(html).toContain("Activity");
    expect(html).toContain('href="/settings/activity"');
  });
});

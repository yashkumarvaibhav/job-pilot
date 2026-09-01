import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TODAY_EMPTY } from "../domain/today";
import { calendarDateInZone } from "../domain/referral";
import { createContact, updateContact } from "../server/repos/contacts";
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

import Home from "./(app)/(today)/page";
import TodayError from "./(app)/(today)/error";
import TodayLoading from "./(app)/(today)/loading";

describe("Today screen", () => {
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

  it("renders the empty sentence, count tiles, and one pipeline block", async () => {
    newFixture();
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain(TODAY_EMPTY);
    expect(html).toContain("Follow-ups");
    expect(html).toContain("Need reply");
    expect(html).toContain("Deadlines");
    expect(html).toContain("Interviews today");
    expect(html).toContain("Saved");
    expect(html).toContain("Referral");
    expect(html).toContain('class="tiles pipeline-tiles"');
    expect(html).toContain('class="tiles today-stat-tiles"');
    expect(html).toContain('class="tnum"');
    expect(html).toContain("Recent activity");
    expect(html).toContain("Workspace created");
    expect(html).toContain('href="/add"');
    expect(html).not.toContain("shadow");
  });

  it("lists a contact due today as Follow up with Rahul Sharma", async () => {
    const fixture = newFixture();
    const asOfOn = calendarDateInZone("Asia/Kolkata");
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
    });
    updateContact(fixture.client.db, fixture.tenantA, "rahul", {
      nextAction: "Follow up about Microsoft openings",
      followUpOn: asOfOn,
    });

    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("Follow up with Rahul Sharma");
    expect(html).toContain("Follow up about Microsoft openings");
    expect(html).not.toContain(TODAY_EMPTY);
  });

  it("designs loading and error states", () => {
    expect(renderToStaticMarkup(<TodayLoading />)).toContain("Loading Today");
    expect(renderToStaticMarkup(<TodayError reset={() => undefined} />)).toContain(
      "Could not load Today",
    );
  });
});

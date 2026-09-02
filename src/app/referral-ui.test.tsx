import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCompany } from "../server/repos/companies";
import { createContact } from "../server/repos/contacts";
import { createOpportunity } from "../server/repos/opportunities";
import { createReferral, updateReferral } from "../server/repos/referrals";
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

import ReferralDetailPage from "./(app)/referrals/[id]/page";
import ReferralsPage from "./(app)/referrals/page";

describe("referral screens", () => {
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

  it("names the empty state that points at an opportunity", async () => {
    newFixture();
    const html = renderToStaticMarkup(
      await ReferralsPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain(
      "No referral requests. Open an opportunity and ask someone.",
    );
    expect(html).toContain("Referral promised but not received");
    expect(html).toContain("No reply");
    expect(html).toContain("4 days");
  });

  it("lists a requested row and excludes it from promised-not-received", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: company.id,
      name: "Rahul Sharma",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "ms-sde",
      companyId: company.id,
      role: "SDE",
    });
    const created = createReferral(fixture.client.db, fixture.tenantA, {
      id: "referral-rahul",
      contactId: "rahul",
      opportunityId: "ms-sde",
      channel: "whatsapp",
      stage: "requested",
      requestedOn: "2026-09-01",
    });

    const all = renderToStaticMarkup(
      await ReferralsPage({ searchParams: Promise.resolve({}) }),
    );
    expect(all).toContain("Rahul Sharma");
    expect(all).toContain("SDE");
    expect(all).toContain("Requested");
    expect(all).toContain('href="/referrals/referral-rahul"');
    expect(all).toContain('class="tbl referral-table"');
    expect(all).toContain('class="referral-card-list"');
    expect(all).toContain('aria-hidden="true"');

    const promised = renderToStaticMarkup(
      await ReferralsPage({
        searchParams: Promise.resolve({ preset: "promised_not_received" }),
      }),
    );
    expect(promised).toContain("No referral requests match these filters.");
    expect(promised).not.toContain('href="/referrals/referral-rahul"');

    updateReferral(fixture.client.db, fixture.tenantA, created!.id, {
      stage: "referral_promised",
    });
    const after = renderToStaticMarkup(
      await ReferralsPage({
        searchParams: Promise.resolve({ preset: "promised_not_received" }),
      }),
    );
    expect(after).toContain("Rahul Sharma");
    expect(after).toContain("Referral Promised");
  });

  it("applies URL-backed referral filters with tenant-owned company options", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "google",
      name: "Google",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: "microsoft",
      name: "Rahul Sharma",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      companyId: "google",
      name: "Priya Nair",
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "rahul-request",
      contactId: "rahul",
      channel: "email",
      stage: "requested",
      requestedOn: "2026-08-20",
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "priya-request",
      contactId: "priya",
      channel: "email",
      stage: "requested",
      requestedOn: "2026-08-20",
    });

    const html = renderToStaticMarkup(
      await ReferralsPage({
        searchParams: Promise.resolve({
          company: "microsoft",
          stage: "requested",
          noResponseDays: "3",
        }),
      }),
    );
    for (const expected of [
      'name="company"',
      'name="stage"',
      'name="noResponseDays"',
      "Apply filters",
      "Clear filters",
      "Rahul Sharma",
    ]) {
      expect(html).toContain(expected);
    }
    expect(html).not.toContain('href="/referrals/priya-request"');
    expect(html).toContain('<option value="microsoft" selected="">Microsoft</option>');

    const empty = renderToStaticMarkup(
      await ReferralsPage({
        searchParams: Promise.resolve({ stage: "declined" }),
      }),
    );
    expect(empty).toContain("No referral requests match these filters.");
  });

  it("keeps Potential Contact in the detail stage list after Received", async () => {
    const fixture = newFixture();
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "referral-rahul",
      contactId: "rahul",
      channel: "whatsapp",
      stage: "referral_received",
    });

    const html = renderToStaticMarkup(
      await ReferralDetailPage({
        params: Promise.resolve({ id: "referral-rahul" }),
      }),
    );
    expect(html).toContain("Potential Contact");
    expect(html).toContain("Referral Received");
    expect(html).toContain("WhatsApp");
    expect(html).toContain("Save referral");
  });

  it("uses the same not-found state for missing and foreign ids", async () => {
    const fixture = newFixture();
    createContact(fixture.client.db, fixture.tenantB, {
      id: "hidden",
      name: "Hidden Person",
    });
    createReferral(fixture.client.db, fixture.tenantB, {
      id: "referral-b",
      contactId: "hidden",
      channel: "email",
    });

    for (const id of ["missing", "referral-b"]) {
      const html = renderToStaticMarkup(
        await ReferralDetailPage({ params: Promise.resolve({ id }) }),
      );
      expect(html).toContain("Referral not found");
      expect(html).not.toContain("Hidden Person");
    }
  });

  it("shows the promised-not-received stale reason on the row", async () => {
    const fixture = newFixture();
    const promisedOn = "2026-08-28";
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: "microsoft",
      name: "Rahul Sharma",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "ms-sde",
      companyId: "microsoft",
      role: "SDE",
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "promised",
      contactId: "rahul",
      opportunityId: "ms-sde",
      channel: "email",
      stage: "referral_promised",
      requestedOn: promisedOn,
      now: new Date("2026-08-28T10:00:00.000Z"),
    });

    const html = renderToStaticMarkup(
      await ReferralsPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("Stale");
    expect(html).toContain("Referral promised");
    expect(html).toContain("not received");
  });
});

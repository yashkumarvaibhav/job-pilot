import { afterEach, describe, expect, it } from "vitest";

import { applyToOpportunity } from "./applications";
import { createCompany } from "./companies";
import {
  createContact,
  listContacts,
  parseContactListFilter,
} from "./contacts";
import {
  createOpportunity,
  listOpportunities,
  parseOpportunityListFilter,
} from "./opportunities";
import {
  createReferral,
  listReferrals,
  parseReferralListFilter,
} from "./referrals";
import { createTenantTestFixture } from "../../test/tenant-fixture";

describe("list filters", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  it("parses canonical contact query values and ignores malformed filters", () => {
    const parsed = parseContactListFilter(
      new URLSearchParams({
        company: "microsoft",
        relationship: "Alumni",
        status: "checking_for_openings",
        noResponseDays: "3",
      }),
      new Date("2026-09-02T12:00:00.000Z"),
    );

    expect(parsed).toEqual({
      companyId: "microsoft",
      relationship: "alumni",
      status: "checking_for_openings",
      noResponseDays: 3,
      asOf: new Date("2026-09-02T12:00:00.000Z"),
    });
    expect(
      parseContactListFilter(
        new URLSearchParams({
          relationship: "unknown",
          status: "invented",
          noResponseDays: "-4",
        }),
      ),
    ).toEqual({});
  });

  it("filters contacts by owned company, status, relationship, and response age", () => {
    const fixture = newFixture();
    const a = fixture.tenantA;
    const b = fixture.tenantB;
    createCompany(fixture.client.db, a, { id: "microsoft", name: "Microsoft" });
    createCompany(fixture.client.db, a, { id: "google", name: "Google" });
    createCompany(fixture.client.db, b, { id: "private", name: "Private Co" });
    createContact(fixture.client.db, a, {
      id: "rahul",
      name: "Rahul",
      companyId: "microsoft",
      relationship: "alumni",
      networkingStatus: "checking_for_openings",
    });
    createContact(fixture.client.db, a, {
      id: "neha",
      name: "Neha",
      companyId: "microsoft",
      relationship: "employee",
      networkingStatus: "checking_for_openings",
    });
    createContact(fixture.client.db, a, {
      id: "old-reply",
      name: "Old reply",
      companyId: "google",
      networkingStatus: "waiting_for_reply",
      lastInteractionAt: new Date("2026-08-28T11:00:00.000Z"),
    });
    createContact(fixture.client.db, a, {
      id: "recent-reply",
      name: "Recent reply",
      companyId: "google",
      networkingStatus: "waiting_for_reply",
      lastInteractionAt: new Date("2026-09-01T11:00:00.000Z"),
    });
    createContact(fixture.client.db, b, {
      id: "private-match",
      name: "Private Match",
      companyId: "private",
      relationship: "alumni",
      networkingStatus: "checking_for_openings",
    });

    expect(
      listContacts(fixture.client.db, a, {
        companyId: "microsoft",
        status: "checking_for_openings",
      }).map((row) => row.id),
    ).toEqual(["neha", "rahul"]);
    expect(
      listContacts(fixture.client.db, a, { relationship: "alumni" }).map(
        (row) => row.id,
      ),
    ).toEqual(["rahul"]);
    expect(
      listContacts(fixture.client.db, a, {
        noResponseDays: 3,
        asOf: new Date("2026-09-02T12:00:00.000Z"),
      }).map((row) => row.id),
    ).toEqual(["old-reply"]);
    expect(JSON.stringify(listContacts(fixture.client.db, a, {}))).not.toContain(
      "Private Match",
    );
  });

  it("filters opportunities by tenant-owned facets and calendar windows", () => {
    const fixture = newFixture();
    const a = fixture.tenantA;
    const b = fixture.tenantB;
    createCompany(fixture.client.db, a, { id: "microsoft", name: "Microsoft" });
    createCompany(fixture.client.db, a, { id: "google", name: "Google" });
    createCompany(fixture.client.db, b, { id: "private", name: "Private Co" });
    createOpportunity(fixture.client.db, a, {
      id: "due-tomorrow",
      companyId: "microsoft",
      role: "SDE",
      priority: "High",
      deadlineOn: "2026-09-03",
    });
    const applied = createOpportunity(fixture.client.db, a, {
      id: "recent-application",
      companyId: "google",
      role: "Backend Engineer",
      priority: "Medium",
      deadlineOn: "2026-09-20",
    });
    applyToOpportunity(fixture.client.db, a, {
      opportunityId: applied.id,
      portal: "Careers",
      appliedOn: "2026-08-15",
    });
    createOpportunity(fixture.client.db, b, {
      id: "private-match",
      companyId: "private",
      role: "Private Role",
      priority: "High",
      deadlineOn: "2026-09-03",
    });

    const deadlineFilter = parseOpportunityListFilter(
      new URLSearchParams({
        company: "microsoft",
        priority: "High",
        deadlineWithinDays: "3",
      }),
      "2026-09-02",
    );
    expect(deadlineFilter).toEqual({
      bucket: "all",
      companyId: "microsoft",
      priority: "High",
      deadlineWithinDays: 3,
      asOfOn: "2026-09-02",
    });
    expect(
      listOpportunities(fixture.client.db, a, deadlineFilter).map(
        (row) => row.id,
      ),
    ).toEqual(["due-tomorrow"]);
    expect(
      listOpportunities(fixture.client.db, a, {
        bucket: "all",
        appliedWithinDays: 30,
        asOfOn: "2026-09-02",
      }).map((row) => row.id),
    ).toEqual(["recent-application"]);
    expect(
      JSON.stringify(listOpportunities(fixture.client.db, a, deadlineFilter)),
    ).not.toContain("Private Role");
  });

  it("filters referral stage, company, and configurable no-response age", () => {
    const fixture = newFixture();
    const a = fixture.tenantA;
    const b = fixture.tenantB;
    for (const [tenant, prefix] of [
      [a, "a"],
      [b, "b"],
    ] as const) {
      createCompany(fixture.client.db, tenant, {
        id: `${prefix}-company`,
        name: prefix === "a" ? "Microsoft" : "Private Co",
      });
      createContact(fixture.client.db, tenant, {
        id: `${prefix}-contact`,
        companyId: `${prefix}-company`,
        name: prefix === "a" ? "Rahul" : "Private Person",
      });
    }
    createReferral(fixture.client.db, a, {
      id: "old-request",
      contactId: "a-contact",
      channel: "email",
      stage: "requested",
      requestedOn: "2026-08-28",
    });
    createReferral(fixture.client.db, a, {
      id: "recent-request",
      contactId: "a-contact",
      channel: "email",
      stage: "requested",
      requestedOn: "2026-09-01",
    });
    createReferral(fixture.client.db, b, {
      id: "private-request",
      contactId: "b-contact",
      channel: "email",
      stage: "requested",
      requestedOn: "2026-08-28",
    });

    const filter = parseReferralListFilter(
      new URLSearchParams({
        company: "a-company",
        stage: "Requested",
        noResponseDays: "3",
      }),
      "2026-09-02",
    );
    expect(filter).toEqual({
      asOfOn: "2026-09-02",
      companyId: "a-company",
      stage: "requested",
      noResponseDays: 3,
    });
    expect(
      listReferrals(fixture.client.db, a, filter).map((row) => row.id),
    ).toEqual(["old-request"]);
    expect(
      JSON.stringify(listReferrals(fixture.client.db, a, filter)),
    ).not.toContain("Private Person");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../test/tenant-fixture";
import { createCompany } from "../server/repos/companies";
import { createContact } from "../server/repos/contacts";

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

import ContactsPage from "./(app)/contacts/page";
import ContactDetailPage from "./(app)/contacts/[id]/page";

describe("contact screens", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
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

  it("names the no-job workflow when the contact list is empty", async () => {
    newFixture();
    const html = renderToStaticMarkup(await ContactsPage());

    expect(html).toContain(
      "No contacts yet. Networking does not need a job first.",
    );
    expect(html).toContain("Add contact");
  });

  it("renders desktop and mobile lists with icon-plus-label statuses", async () => {
    const fixture = newFixture();
    const microsoft = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: microsoft.id,
      name: "Rahul Sharma",
      designation: "Software Engineer",
      relationship: "friend",
      networkingStatus: "checking_for_openings",
      nextAction: "Follow up",
      followUpOn: "2026-09-02",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "independent",
      name: "Independent Contact",
      relationship: "alumni",
    });

    const html = renderToStaticMarkup(await ContactsPage());

    expect(html).toContain('class="tbl contact-table"');
    expect(html).toContain('class="contact-card-list"');
    expect(html).toContain("Rahul Sharma");
    expect(html).toContain("Microsoft");
    expect(html).toContain("Checking for Openings");
    expect(html).toContain("Independent Contact");
    expect(html).toContain("No company");
    expect(html).toContain('aria-hidden="true"');
  });

  it("renders contact identity, methods and every networking status on detail", async () => {
    const fixture = newFixture();
    const microsoft = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: microsoft.id,
      name: "Rahul Sharma",
      designation: "Software Engineer",
      relationship: "friend",
      location: "Bengaluru",
      source: "College network",
      networkingStatus: "checking_for_openings",
      preferredContactChannel: "email",
      tags: ["backend", "alumni"],
      notes: "Ask about platform roles.",
      methods: [
        { kind: "email", value: "rahul@invalid.test", isPrimary: true },
        { kind: "whatsapp", value: "+91 99999 88888" },
      ],
    });

    const html = renderToStaticMarkup(
      await ContactDetailPage({ params: Promise.resolve({ id: "rahul" }) }),
    );

    for (const expected of [
      "Rahul Sharma",
      "Microsoft",
      "Software Engineer",
      "Bengaluru",
      "College network",
      "Checking for Openings",
      "rahul@invalid.test",
      "+91 99999 88888",
      "backend",
      "alumni",
      "Ask about platform roles.",
      "No interactions yet. Log a WhatsApp, a LinkedIn note, or an email.",
      "Edit contact",
    ]) {
      expect(html).toContain(expected);
    }
    for (const status of [
      "Not Contacted",
      "Ready to Contact",
      "Contacted",
      "Waiting for Reply",
      "Checking for Openings",
      "Follow Up Later",
      "Opening Found",
      "Referral Discussion",
      "Referral Promised",
      "No Openings Currently",
      "Keep in Touch",
      "Do Not Contact",
      "Inactive",
    ]) {
      expect(html).toContain(status);
    }
  });

  it("uses one Contact not found state for missing and foreign ids", async () => {
    const fixture = newFixture();
    createContact(fixture.client.db, fixture.tenantB, {
      id: "private-contact",
      name: "Private Person",
    });

    for (const id of ["missing", "private-contact"]) {
      const html = renderToStaticMarkup(
        await ContactDetailPage({ params: Promise.resolve({ id }) }),
      );
      expect(html).toContain("Contact not found");
      expect(html).not.toContain("Private Person");
    }
  });
});

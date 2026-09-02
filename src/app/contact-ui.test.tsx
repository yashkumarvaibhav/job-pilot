import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../test/tenant-fixture";
import { createCompany } from "../server/repos/companies";
import { createContact } from "../server/repos/contacts";
import { createInteraction } from "../server/repos/interactions";
import {
  createOpportunityFromConversation,
} from "../server/repos/opportunities";

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

import { ContactEditForm } from "../components/contact-form";
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

  it("renders URL-backed contact filters and filtered empty copy", async () => {
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
      relationship: "alumni",
      networkingStatus: "checking_for_openings",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      companyId: "google",
      name: "Priya Nair",
      networkingStatus: "not_contacted",
    });

    const html = renderToStaticMarkup(
      await ContactsPage({
        searchParams: Promise.resolve({
          company: "microsoft",
          relationship: "alumni",
          status: "checking_for_openings",
        }),
      }),
    );
    for (const expected of [
      'name="company"',
      'name="relationship"',
      'name="status"',
      'name="noResponseDays"',
      "Apply filters",
      "Clear filters",
      "Rahul Sharma",
    ]) {
      expect(html).toContain(expected);
    }
    expect(html).not.toContain("Priya Nair");
    expect(html).toContain('<option value="microsoft" selected="">Microsoft</option>');
    expect(html).toContain('<option value="alumni" selected="">Alumni</option>');

    const empty = renderToStaticMarkup(
      await ContactsPage({
        searchParams: Promise.resolve({ status: "do_not_contact" }),
      }),
    );
    expect(empty).toContain("No contacts match these filters.");
    expect(empty).not.toContain("No contacts yet.");
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
      "Create opportunity from conversation",
      "Log the opening first",
      "No opportunities linked yet.",
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

  it("lists every §11 channel on the log form and renders logged rows", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
    });
    createInteraction(fixture.client.db, fixture.tenantA, {
      id: "whatsapp-out",
      contactId: "rahul",
      channel: "whatsapp",
      direction: "outbound",
      body: "Are there any SWE openings in your team/company?",
      occurredAt: new Date("2026-08-30T10:32:00.000Z"),
    });
    createInteraction(fixture.client.db, fixture.tenantA, {
      id: "whatsapp-in",
      contactId: "rahul",
      channel: "whatsapp",
      direction: "inbound",
      body: "Let me check. Give me 2-3 days.",
      requiresReply: true,
      occurredAt: new Date("2026-08-30T11:14:00.000Z"),
    });

    const html = renderToStaticMarkup(
      await ContactDetailPage({ params: Promise.resolve({ id: "rahul" }) }),
    );

    expect(html).toContain("Log interaction");
    expect(html).toContain("Nothing here is sent.");
    expect(html).toContain("Are there any SWE openings in your team/company?");
    expect(html).toContain("Let me check. Give me 2-3 days.");
    expect(html).toContain("Needs my reply");
    expect(html).toContain("Mark replied");
    expect(html).toContain("16:02");
    expect(html).toContain('class="tnum"');
    expect(html).not.toContain(
      "No interactions yet. Log a WhatsApp, a LinkedIn note, or an email.",
    );
    expect(html).toContain("Create opportunity from conversation");
    expect(html).not.toContain("Log the opening first");
    expect(html).toContain('aria-expanded="false"');
    for (const channel of [
      "Email",
      "LinkedIn DM",
      "LinkedIn connection note",
      "WhatsApp",
      "Phone",
      "Telegram",
      "Slack / Discord",
      "Company referral portal",
      "Alumni network",
      "College network",
      "In-person",
      "Other",
    ]) {
      expect(html).toContain(channel);
    }
  });

  it("lists the linked opportunity after creating from conversation", async () => {
    const fixture = newFixture();
    const microsoft = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: microsoft.id,
      name: "Rahul Sharma",
    });
    createInteraction(fixture.client.db, fixture.tenantA, {
      contactId: "rahul",
      channel: "whatsapp",
      direction: "inbound",
      body: "There's an SDE opening. Job ID 182763.",
    });
    createOpportunityFromConversation(fixture.client.db, fixture.tenantA, {
      id: "microsoft-sde",
      contactId: "rahul",
      role: "SDE",
      jobId: "182763",
    });

    const html = renderToStaticMarkup(
      await ContactDetailPage({ params: Promise.resolve({ id: "rahul" }) }),
    );

    expect(html).toContain("Linked opportunities");
    expect(html).toContain("SDE");
    expect(html).toContain("182763");
    expect(html).toContain('href="/opportunities/microsoft-sde"');
    expect(html).toContain("opportunity-table");
    expect(html).toContain("opportunity-card-list");
    expect(html).toContain("SDE opening. Job ID 182763");
    expect(html).toContain("Referral requests");
    expect(html).toContain("No referral requests for this person yet.");
  });

  it("lets a contact type a company name that does not exist yet", () => {
    newFixture();
    const html = renderToStaticMarkup(
      <ContactEditForm
        companies={[]}
        contact={{
          id: "neha",
          companyId: null,
          name: "Neha Gupta",
          designation: null,
          relationship: "friend",
          source: null,
          location: null,
          notes: null,
          tags: [],
          preferredContactChannel: null,
          networkingStatus: "not_contacted",
          nextAction: null,
          followUpOn: null,
          methods: [],
        }}
      />,
    );

    expect(html).toContain('name="companyName"');
    expect(html).toContain(
      "Type a name. A new company is created if this workspace does not",
    );
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

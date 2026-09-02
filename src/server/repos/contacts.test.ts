import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createCompany, listCompanies } from "./companies";
import {
  ContactInputError,
  createContact,
  deleteContact,
  getContact,
  listContacts,
  updateContact,
} from "./contacts";

describe("contact repository", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  it("creates, lists and reloads a contact with methods in its workspace", () => {
    const fixture = newFixture();
    const microsoft = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });

    const created = createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: microsoft.id,
      name: " Rahul Sharma ",
      designation: "Software Engineer",
      relationship: "friend",
      source: "College network",
      location: "Bengaluru",
      notes: "Ask about platform roles.",
      tags: ["backend", " alumni ", "backend"],
      preferredContactChannel: "whatsapp",
      networkingStatus: "checking_for_openings",
      nextAction: "Follow up",
      followUpOn: "2026-09-02",
      methods: [
        { kind: "email", value: " Rahul@Invalid.Test ", isPrimary: true },
        { kind: "linkedin", value: "https://linkedin.com/in/rahul" },
        { kind: "whatsapp", value: "+91 99999 88888" },
      ],
      now: new Date("2026-09-01T06:00:00.000Z"),
    });

    expect(created).toMatchObject({
      id: "rahul",
      companyId: "microsoft",
      companyName: "Microsoft",
      name: "Rahul Sharma",
      relationship: "friend",
      networkingStatus: "checking_for_openings",
      tagsJson: ["backend", "alumni"],
    });
    expect(created.methods).toEqual([
      expect.objectContaining({
        kind: "email",
        value: "Rahul@Invalid.Test",
        valueNormalized: "rahul@invalid.test",
        isPrimary: true,
      }),
      expect.objectContaining({
        kind: "linkedin",
        valueNormalized: "https://linkedin.com/in/rahul",
      }),
      expect.objectContaining({
        kind: "whatsapp",
        valueNormalized: "+919999988888",
      }),
    ]);
    expect(listContacts(fixture.client.db, fixture.tenantA)).toEqual([
      expect.objectContaining({ id: "rahul", companyName: "Microsoft" }),
    ]);
    expect(getContact(fixture.client.db, fixture.tenantA, "rahul")).toEqual(
      created,
    );
    expect(listContacts(fixture.client.db, fixture.tenantB)).toEqual([]);
  });

  it("saves and reloads a contact without a company or opportunity", () => {
    const fixture = newFixture();

    const created = createContact(fixture.client.db, fixture.tenantA, {
      id: "independent-contact",
      name: "Independent Contact",
      relationship: "alumni",
      networkingStatus: "ready_to_contact",
    });

    expect(created).toMatchObject({
      id: "independent-contact",
      companyId: null,
      companyName: null,
      name: "Independent Contact",
    });
    expect(
      getContact(fixture.client.db, fixture.tenantA, "independent-contact"),
    ).toEqual(created);
  });

  it("scopes company links and foreign contact ids as not found without activity", () => {
    const fixture = newFixture();
    const privateCompany = createCompany(
      fixture.client.db,
      fixture.tenantB,
      { id: "private-company", name: "Private Company" },
    );
    const privateContact = createContact(fixture.client.db, fixture.tenantB, {
      id: "private-contact",
      companyId: privateCompany.id,
      name: "Private Person",
      methods: [{ kind: "email", value: "private@invalid.test" }],
    });
    const before = fixture.rowCount("activity_event");

    expect(() =>
      createContact(fixture.client.db, fixture.tenantA, {
        name: "Cross tenant link",
        companyId: privateCompany.id,
      }),
    ).toThrowError(ContactInputError);
    expect(
      getContact(fixture.client.db, fixture.tenantA, privateContact.id),
    ).toBeUndefined();
    expect(
      updateContact(
        fixture.client.db,
        fixture.tenantA,
        privateContact.id,
        { name: "Leaked" },
      ),
    ).toBeUndefined();
    expect(
      deleteContact(
        fixture.client.db,
        fixture.tenantA,
        privateContact.id,
      ),
    ).toBe(false);
    expect(fixture.rowCount("activity_event")).toBe(before);
  });

  it("keeps contact-method uniqueness inside one workspace", () => {
    const fixture = newFixture();
    createContact(fixture.client.db, fixture.tenantA, {
      id: "contact-a",
      name: "Contact A",
      methods: [{ kind: "email", value: "same@invalid.test" }],
    });
    const beforeContacts = fixture.rowCount("contact");
    const beforeEvents = fixture.rowCount("activity_event");

    expect(() =>
      createContact(fixture.client.db, fixture.tenantA, {
        id: "duplicate-a",
        name: "Duplicate A",
        methods: [{ kind: "email", value: "SAME@invalid.test" }],
      }),
    ).toThrowError(ContactInputError);
    expect(fixture.rowCount("contact")).toBe(beforeContacts);
    expect(fixture.rowCount("activity_event")).toBe(beforeEvents);

    expect(
      createContact(fixture.client.db, fixture.tenantB, {
        id: "contact-b",
        name: "Contact B",
        methods: [{ kind: "email", value: "same@invalid.test" }],
      }),
    ).toMatchObject({ id: "contact-b" });
  });

  it("requires an explicit override to leave Do Not Contact", () => {
    const fixture = newFixture();
    createContact(fixture.client.db, fixture.tenantA, {
      id: "blocked",
      name: "Blocked Contact",
      networkingStatus: "do_not_contact",
    });

    expect(() =>
      updateContact(fixture.client.db, fixture.tenantA, "blocked", {
        networkingStatus: "keep_in_touch",
      }),
    ).toThrowError(/explicit override/);
    expect(getContact(fixture.client.db, fixture.tenantA, "blocked")).toMatchObject(
      { networkingStatus: "do_not_contact" },
    );

    expect(
      updateContact(fixture.client.db, fixture.tenantA, "blocked", {
        networkingStatus: "keep_in_touch",
        overrideDoNotContact: true,
      }),
    ).toMatchObject({ networkingStatus: "keep_in_touch" });
  });

  it("replaces methods atomically, then cascades them when deleting the contact", () => {
    const fixture = newFixture();
    createContact(fixture.client.db, fixture.tenantA, {
      id: "contact-a",
      name: "Contact A",
      methods: [{ kind: "email", value: "old@invalid.test" }],
    });

    const updated = updateContact(
      fixture.client.db,
      fixture.tenantA,
      "contact-a",
      {
        methods: [
          { kind: "email", value: "new@invalid.test", isPrimary: true },
          { kind: "phone", value: "+91 98765 43210" },
        ],
      },
      new Date("2026-09-01T07:00:00.000Z"),
    );
    expect(updated?.methods).toHaveLength(2);
    expect(updated?.methods.map(({ valueNormalized }) => valueNormalized)).toEqual([
      "new@invalid.test",
      "+919876543210",
    ]);

    expect(deleteContact(fixture.client.db, fixture.tenantA, "contact-a")).toBe(
      true,
    );
    expect(fixture.rowCount("contact_method")).toBe(0);
    expect(getContact(fixture.client.db, fixture.tenantA, "contact-a")).toBeUndefined();
  });

  it("creates a company from a typed name and reuses the workspace match", () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantB, {
      id: "foreign-microsoft",
      name: "Microsoft",
    });

    const created = createContact(fixture.client.db, fixture.tenantA, {
      id: "neha",
      companyName: " Microsoft ",
      name: "Neha Gupta",
      relationship: "friend",
    });
    const reused = createContact(fixture.client.db, fixture.tenantA, {
      id: "second",
      companyName: "microsoft",
      name: "Second Contact",
    });

    expect(created.companyName).toBe("Microsoft");
    expect(reused.companyId).toBe(created.companyId);
    expect(listCompanies(fixture.client.db, fixture.tenantA)).toHaveLength(1);
    expect(created.companyId).not.toBe("foreign-microsoft");
    expect(
      getContact(fixture.client.db, fixture.tenantB, "neha"),
    ).toBeUndefined();
  });

  it("rejects sending both a company id and a company name", () => {
    const fixture = newFixture();
    const microsoft = createCompany(fixture.client.db, fixture.tenantA, {
      name: "Microsoft",
    });

    expect(() =>
      createContact(fixture.client.db, fixture.tenantA, {
        name: "Neha Gupta",
        companyId: microsoft.id,
        companyName: "Microsoft",
      }),
    ).toThrow(ContactInputError);
  });
});

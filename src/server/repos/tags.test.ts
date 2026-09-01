import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createCompany } from "./companies";
import { createContact } from "./contacts";
import {
  attachTag,
  deleteTag,
  detachTag,
  getTag,
  listEntityTags,
  listTags,
} from "./tags";

describe("tag repository", () => {
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

  function seedOwned(fixture: ReturnType<typeof newFixture>) {
    const companyA = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    const contactA = createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      companyId: "microsoft",
    });
    const companyB = createCompany(fixture.client.db, fixture.tenantB, {
      id: "private-co",
      name: "Private Co",
    });
    return { companyA, contactA, companyB };
  }

  it("lets the same tag sit on a company and a contact", () => {
    const fixture = newFixture();
    seedOwned(fixture);

    const onCompany = attachTag(fixture.client.db, fixture.tenantA, {
      id: "dream",
      label: "Dream Company",
      entityType: "company",
      entityId: "microsoft",
    });
    const onContact = attachTag(fixture.client.db, fixture.tenantA, {
      label: "dream company",
      entityType: "contact",
      entityId: "rahul",
    });

    expect(onCompany).toEqual({ tagId: "dream", label: "Dream Company" });
    expect(onContact).toEqual({ tagId: "dream", label: "Dream Company" });
    expect(listTags(fixture.client.db, fixture.tenantA)).toHaveLength(1);
    expect(
      listEntityTags(fixture.client.db, fixture.tenantA, "company", "microsoft"),
    ).toEqual([{ tagId: "dream", label: "Dream Company" }]);
    expect(
      listEntityTags(fixture.client.db, fixture.tenantA, "contact", "rahul"),
    ).toEqual([{ tagId: "dream", label: "Dream Company" }]);
  });

  it("keeps the entity when the tag is deleted", () => {
    const fixture = newFixture();
    const { companyA } = seedOwned(fixture);
    attachTag(fixture.client.db, fixture.tenantA, {
      id: "dream",
      label: "Dream Company",
      entityType: "company",
      entityId: companyA.id,
    });

    expect(deleteTag(fixture.client.db, fixture.tenantA, "dream")).toBe(true);
    expect(getTag(fixture.client.db, fixture.tenantA, "dream")).toBeUndefined();
    expect(
      listEntityTags(fixture.client.db, fixture.tenantA, "company", "microsoft"),
    ).toEqual([]);
    expect(fixture.rowCount("company")).toBe(2);
    expect(
      fixture.client.sqlite
        .prepare("select name from company where id = ?")
        .get("microsoft"),
    ).toEqual({ name: "Microsoft" });
  });

  it("isolates tags, entity links, and refuses a cross-workspace insert", () => {
    const fixture = newFixture();
    const { companyA, companyB } = seedOwned(fixture);
    attachTag(fixture.client.db, fixture.tenantA, {
      id: "dream",
      label: "Dream Company",
      entityType: "company",
      entityId: companyA.id,
    });
    attachTag(fixture.client.db, fixture.tenantB, {
      id: "foreign-dream",
      label: "Dream Company",
      entityType: "company",
      entityId: companyB.id,
    });

    expect(listTags(fixture.client.db, fixture.tenantA)).toEqual([
      expect.objectContaining({ id: "dream", label: "Dream Company" }),
    ]);
    expect(
      attachTag(fixture.client.db, fixture.tenantA, {
        label: "Dream Company",
        entityType: "company",
        entityId: companyB.id,
      }),
    ).toBeUndefined();
    expect(
      detachTag(fixture.client.db, fixture.tenantA, {
        tagId: "foreign-dream",
        entityType: "company",
        entityId: companyB.id,
      }),
    ).toBe(false);
    expect(deleteTag(fixture.client.db, fixture.tenantA, "foreign-dream")).toBe(
      false,
    );
    expect(
      listEntityTags(
        fixture.client.db,
        fixture.tenantA,
        "company",
        companyB.id,
      ),
    ).toEqual([]);
    expect(fixture.rowCount("entity_tag")).toBe(2);

    expect(() =>
      fixture.client.sqlite
        .prepare(
          `insert into entity_tag
            (id, workspace_id, tag_id, entity_type, entity_id, created_at)
           values ('cross', ?, ?, 'company', ?, ?)`,
        )
        .run(
          fixture.tenantA.workspaceId,
          "foreign-dream",
          companyA.id,
          Date.now(),
        ),
    ).toThrowError(/FOREIGN KEY/i);
  });
});

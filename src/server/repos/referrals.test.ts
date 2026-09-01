import { afterEach, describe, expect, it } from "vitest";

import { applyToOpportunity } from "./applications";
import { createCompany } from "./companies";
import { createContact } from "./contacts";
import { createOpportunity } from "./opportunities";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import {
  ReferralInputError,
  createReferral,
  getReferral,
  listReferrals,
  updateReferral,
} from "./referrals";

describe("referral repository", () => {
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

  function seedWorkspace(
    fixture: ReturnType<typeof createTenantTestFixture>,
    tenant: "tenantA" | "tenantB",
    ids: { companyId: string; contactId: string; opportunityId: string },
  ) {
    const owner = fixture[tenant];
    const name = tenant === "tenantA" ? "Microsoft" : "Private Co";
    const contactName = tenant === "tenantA" ? "Rahul Sharma" : "Hidden Person";
    const role = tenant === "tenantA" ? "SDE" : "Private Role";
    createCompany(fixture.client.db, owner, {
      id: ids.companyId,
      name,
    });
    createContact(fixture.client.db, owner, {
      id: ids.contactId,
      companyId: ids.companyId,
      name: contactName,
    });
    createOpportunity(fixture.client.db, owner, {
      id: ids.opportunityId,
      companyId: ids.companyId,
      role,
    });
  }

  it("creates a referral with a contact and no opportunity", () => {
    const fixture = newFixture();
    seedWorkspace(fixture, "tenantA", {
      companyId: "microsoft",
      contactId: "rahul",
      opportunityId: "ms-sde",
    });

    const created = createReferral(fixture.client.db, fixture.tenantA, {
      id: "referral-rahul",
      contactId: "rahul",
      channel: "whatsapp",
      stage: "potential_contact",
      now: new Date("2026-09-01T12:00:00.000Z"),
    });

    expect(created).toMatchObject({
      id: "referral-rahul",
      contactId: "rahul",
      opportunityId: null,
      contactName: "Rahul Sharma",
      companyName: "Microsoft",
      role: null,
      stage: "potential_contact",
      channel: "whatsapp",
    });
    expect(
      fixture.client.sqlite
        .prepare(
          "select kind from activity_event where workspace_id = ? and kind like 'REFERRAL_%'",
        )
        .all(fixture.tenantA.workspaceId),
    ).toEqual([{ kind: "REFERRAL_CREATED" }]);
  });

  it("lists the promised-not-received preset and hides a requested row", () => {
    const fixture = newFixture();
    seedWorkspace(fixture, "tenantA", {
      companyId: "microsoft",
      contactId: "rahul",
      opportunityId: "ms-sde",
    });
    const requested = createReferral(fixture.client.db, fixture.tenantA, {
      id: "referral-requested",
      contactId: "rahul",
      opportunityId: "ms-sde",
      channel: "whatsapp",
      stage: "requested",
      requestedOn: "2026-09-01",
      todayOn: "2026-09-01",
    });
    expect(
      listReferrals(fixture.client.db, fixture.tenantA, {
        asOfOn: "2026-09-01",
        preset: "promised_not_received",
      }),
    ).toEqual([]);

    const promised = updateReferral(
      fixture.client.db,
      fixture.tenantA,
      requested!.id,
      { stage: "referral_promised", now: new Date("2026-09-01T12:05:00.000Z") },
    );

    expect(promised).toMatchObject({ stage: "referral_promised" });
    expect(
      listReferrals(fixture.client.db, fixture.tenantA, {
        asOfOn: "2026-09-01",
        preset: "promised_not_received",
      }),
    ).toEqual([
      expect.objectContaining({
        id: requested!.id,
        contactName: "Rahul Sharma",
        role: "SDE",
        companyName: "Microsoft",
      }),
    ]);
  });

  it("treats received without an application as received-not-applied", () => {
    const fixture = newFixture();
    seedWorkspace(fixture, "tenantA", {
      companyId: "microsoft",
      contactId: "rahul",
      opportunityId: "ms-sde",
    });
    const created = createReferral(fixture.client.db, fixture.tenantA, {
      contactId: "rahul",
      opportunityId: "ms-sde",
      channel: "email",
      stage: "referral_received",
      todayOn: "2026-09-01",
    });

    expect(
      listReferrals(fixture.client.db, fixture.tenantA, {
        asOfOn: "2026-09-01",
        preset: "received_not_applied",
      }),
    ).toEqual([expect.objectContaining({ id: created!.id })]);

    applyToOpportunity(fixture.client.db, fixture.tenantA, {
      opportunityId: "ms-sde",
      portal: "Greenhouse",
      appliedOn: "2026-09-01",
    });

    expect(
      listReferrals(fixture.client.db, fixture.tenantA, {
        asOfOn: "2026-09-01",
        preset: "received_not_applied",
      }),
    ).toEqual([]);
  });

  it("scopes create, list, and stage changes to the owning workspace", () => {
    const fixture = newFixture();
    seedWorkspace(fixture, "tenantA", {
      companyId: "microsoft",
      contactId: "rahul",
      opportunityId: "ms-sde",
    });
    seedWorkspace(fixture, "tenantB", {
      companyId: "private-co",
      contactId: "hidden",
      opportunityId: "private-role",
    });
    const owned = createReferral(fixture.client.db, fixture.tenantA, {
      contactId: "rahul",
      opportunityId: "ms-sde",
      channel: "whatsapp",
      stage: "requested",
      todayOn: "2026-09-01",
    });
    const foreign = createReferral(fixture.client.db, fixture.tenantB, {
      id: "referral-b",
      contactId: "hidden",
      opportunityId: "private-role",
      channel: "email",
      stage: "referral_promised",
    });
    const before = fixture.rowCount("activity_event");

    expect(
      createReferral(fixture.client.db, fixture.tenantA, {
        contactId: "hidden",
        opportunityId: "ms-sde",
        channel: "whatsapp",
      }),
    ).toBeUndefined();
    expect(
      createReferral(fixture.client.db, fixture.tenantA, {
        contactId: "rahul",
        opportunityId: "private-role",
        channel: "whatsapp",
      }),
    ).toBeUndefined();
    expect(getReferral(fixture.client.db, fixture.tenantA, foreign!.id)).toBe(
      undefined,
    );
    expect(
      updateReferral(fixture.client.db, fixture.tenantA, foreign!.id, {
        stage: "referral_received",
      }),
    ).toBeUndefined();
    expect(
      listReferrals(fixture.client.db, fixture.tenantA, {
        asOfOn: "2026-09-01",
        preset: "promised_not_received",
      }),
    ).toEqual([]);
    expect(
      listReferrals(fixture.client.db, fixture.tenantA, { asOfOn: "2026-09-01" }),
    ).toEqual([expect.objectContaining({ id: owned!.id })]);
    expect(fixture.rowCount("activity_event")).toBe(before);
    expect(
      getReferral(fixture.client.db, fixture.tenantB, foreign!.id),
    ).toMatchObject({ stage: "referral_promised" });
  });

  it("rejects illegal stages and closed-to-received jumps", () => {
    const fixture = newFixture();
    seedWorkspace(fixture, "tenantA", {
      companyId: "microsoft",
      contactId: "rahul",
      opportunityId: "ms-sde",
    });
    const created = createReferral(fixture.client.db, fixture.tenantA, {
      contactId: "rahul",
      channel: "whatsapp",
      stage: "cancelled",
    });

    expect(() =>
      createReferral(fixture.client.db, fixture.tenantA, {
        contactId: "rahul",
        channel: "carrier_pigeon" as never,
      }),
    ).toThrowError(ReferralInputError);
    expect(() =>
      updateReferral(fixture.client.db, fixture.tenantA, created!.id, {
        stage: "not_a_stage" as never,
      }),
    ).toThrowError(ReferralInputError);
    expect(() =>
      updateReferral(fixture.client.db, fixture.tenantA, created!.id, {
        stage: "referral_received",
      }),
    ).toThrowError(ReferralInputError);
    expect(
      updateReferral(fixture.client.db, fixture.tenantA, created!.id, {
        stage: "potential_contact",
      }),
    ).toMatchObject({ stage: "potential_contact" });
  });
});

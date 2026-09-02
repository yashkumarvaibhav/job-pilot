import { afterEach, describe, expect, it } from "vitest";

import {
  DUPLICATE_COMPANY_WARNING,
  DUPLICATE_JOB_WARNING,
  DuplicateConflictError,
} from "../../domain/duplicate";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createCompany } from "./companies";
import { createOpportunity } from "./opportunities";

describe("duplicate create guards", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    return fixture;
  }

  it("refuses a same-name company and keeps the original row", () => {
    const fixture = newFixture();
    const original = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createCompany(fixture.client.db, fixture.tenantB, {
      id: "private-microsoft",
      name: "Microsoft",
      website: "https://private.invalid.test",
    });

    try {
      createCompany(fixture.client.db, fixture.tenantA, { name: "microsoft" });
      throw new Error("expected DuplicateConflictError");
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateConflictError);
      expect(error).toMatchObject({
        message: DUPLICATE_COMPANY_WARNING,
        candidates: [
          {
            id: original.id,
            entityType: "company",
            label: "Microsoft",
            href: `/companies/${original.id}`,
            signals: ["same_name"],
          },
        ],
      });
    }
    expect(fixture.rowCount("company")).toBe(2);
  });

  it("creates a second company when the owner acknowledges the warning", () => {
    const fixture = newFixture();
    const original = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
      careersUrl: "https://careers.microsoft.invalid.test",
    });

    const created = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft-2",
      name: "MSFT",
      careersUrl: "https://careers.microsoft.invalid.test/",
      acknowledgeDuplicates: true,
    });

    expect(created.id).not.toBe(original.id);
    expect(fixture.rowCount("company")).toBe(2);
    const payload = fixture.client.sqlite
      .prepare(
        "select payload_json as payload from activity_event where entity_id = ?",
      )
      .get(created.id) as { payload: string };
    expect(JSON.parse(payload.payload)).toEqual({
      duplicateOverride: true,
      candidateIds: [original.id],
      signals: ["same_url"],
    });
  });

  it("always warns on the same job ID at the same company and never lists another workspace", () => {
    const fixture = newFixture();
    const companyA = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    const companyB = createCompany(fixture.client.db, fixture.tenantB, {
      id: "private",
      name: "Microsoft",
    });
    const original = createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "ms-sde",
      companyId: companyA.id,
      role: "SDE",
      jobId: "182763",
    });
    createOpportunity(fixture.client.db, fixture.tenantB, {
      id: "private-sde",
      companyId: companyB.id,
      role: "SDE",
      jobId: "182763",
    });

    try {
      createOpportunity(fixture.client.db, fixture.tenantA, {
        companyId: companyA.id,
        role: "SDE II",
        jobId: "182763",
      });
      throw new Error("expected DuplicateConflictError");
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateConflictError);
      expect(error).toMatchObject({
        message: DUPLICATE_JOB_WARNING,
        candidates: [
          {
            id: original.id,
            label: "Microsoft · SDE",
            href: `/opportunities/${original.id}`,
            signals: ["same_company_job_id"],
          },
        ],
      });
    }

    const created = createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "ms-sde-2",
      companyId: companyA.id,
      role: "SDE",
      jobId: "182763",
      acknowledgeDuplicates: true,
    });
    expect(created.id).not.toBe(original.id);
    expect(
      fixture.client.sqlite
        .prepare(
          "select count(*) as count from opportunity where workspace_id = ? and company_id = ? and job_id = ?",
        )
        .get(fixture.tenantA.workspaceId, companyA.id, "182763"),
    ).toEqual({ count: 2 });
  });
});

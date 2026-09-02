import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createCompany } from "./companies";
import {
  ApplicationInputError,
  applyToOpportunity,
  getApplication,
  listApplications,
  updateApplication,
} from "./applications";
import {
  DocumentInputError,
  countVersionUsage,
  createDocument,
  deleteDocumentVersion,
  storeDocumentVersion,
} from "./documents";
import { createOpportunity, getOpportunity } from "./opportunities";

describe("application repository", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    const uploadsRoot = mkdtempSync(join(tmpdir(), "job-pilot-app-docs-"));
    fixtures.push({
      dispose: () => {
        fixture.dispose();
        rmSync(uploadsRoot, { force: true, recursive: true });
      },
    });
    return { ...fixture, uploadsRoot };
  }

  function seedOwnedOpportunity(
    fixture: ReturnType<typeof createTenantTestFixture>,
    tenant: "tenantA" | "tenantB",
    ids: { companyId: string; opportunityId: string; role: string },
  ) {
    const owner = fixture[tenant];
    createCompany(fixture.client.db, owner, {
      id: ids.companyId,
      name: tenant === "tenantA" ? "Google" : "Private Co",
    });
    return createOpportunity(fixture.client.db, owner, {
      id: ids.opportunityId,
      companyId: ids.companyId,
      role: ids.role,
      stage: "ready_to_apply",
    });
  }

  it("applies once per opportunity and prefers application.stage on the rollup", () => {
    const fixture = newFixture();
    seedOwnedOpportunity(fixture, "tenantA", {
      companyId: "google",
      opportunityId: "google-swe",
      role: "Software Engineer",
    });

    const first = applyToOpportunity(fixture.client.db, fixture.tenantA, {
      id: "application-google",
      opportunityId: "google-swe",
      portal: "Greenhouse",
      appliedOn: "2026-09-01",
      now: new Date("2026-09-01T12:00:00.000Z"),
    });
    const second = applyToOpportunity(fixture.client.db, fixture.tenantA, {
      opportunityId: "google-swe",
      portal: "Lever",
      appliedOn: "2026-09-02",
    });
    const moved = updateApplication(
      fixture.client.db,
      fixture.tenantA,
      first!.id,
      { stage: "under_review" },
      new Date("2026-09-01T12:05:00.000Z"),
    );
    const opportunity = getOpportunity(
      fixture.client.db,
      fixture.tenantA,
      "google-swe",
    );

    expect(first).toMatchObject({
      opportunityId: "google-swe",
      portal: "Greenhouse",
      appliedOn: "2026-09-01",
      stage: "applied",
      companyName: "Google",
      role: "Software Engineer",
    });
    expect(second?.id).toBe(first?.id);
    expect(second?.portal).toBe("Greenhouse");
    expect(fixture.rowCount("application")).toBe(1);
    expect(moved).toMatchObject({ stage: "under_review" });
    expect(opportunity).toMatchObject({
      stage: "applied",
      application: expect.objectContaining({
        id: first!.id,
        stage: "under_review",
        portal: "Greenhouse",
      }),
    });
    expect(
      fixture.client.sqlite
        .prepare(
          "select kind from activity_event where workspace_id = ? and kind like 'APPLICATION_%' order by at",
        )
        .all(fixture.tenantA.workspaceId),
    ).toEqual([
      { kind: "APPLICATION_SUBMITTED" },
      { kind: "APPLICATION_UPDATED" },
    ]);
  });

  it("scopes apply, list, and stage changes to the owning workspace", () => {
    const fixture = newFixture();
    seedOwnedOpportunity(fixture, "tenantA", {
      companyId: "google",
      opportunityId: "google-swe",
      role: "Software Engineer",
    });
    seedOwnedOpportunity(fixture, "tenantB", {
      companyId: "private-co",
      opportunityId: "private-role",
      role: "Private Role",
    });
    const owned = applyToOpportunity(fixture.client.db, fixture.tenantA, {
      opportunityId: "google-swe",
      portal: "Greenhouse",
      appliedOn: "2026-09-01",
    });
    const foreign = applyToOpportunity(fixture.client.db, fixture.tenantB, {
      id: "application-b",
      opportunityId: "private-role",
      portal: "Workday",
      appliedOn: "2026-09-01",
    });
    const before = fixture.rowCount("activity_event");

    expect(
      applyToOpportunity(fixture.client.db, fixture.tenantA, {
        opportunityId: "private-role",
        portal: "Greenhouse",
        appliedOn: "2026-09-01",
      }),
    ).toBeUndefined();
    expect(getApplication(fixture.client.db, fixture.tenantA, foreign!.id)).toBe(
      undefined,
    );
    expect(
      updateApplication(fixture.client.db, fixture.tenantA, foreign!.id, {
        stage: "under_review",
      }),
    ).toBeUndefined();
    expect(listApplications(fixture.client.db, fixture.tenantA)).toEqual([
      expect.objectContaining({ id: owned!.id, companyName: "Google" }),
    ]);
    expect(getOpportunity(fixture.client.db, fixture.tenantA, "private-role")).toBe(
      undefined,
    );
    expect(fixture.rowCount("activity_event")).toBe(before);
    expect(getApplication(fixture.client.db, fixture.tenantB, foreign!.id)).toMatchObject(
      { stage: "applied" },
    );
  });

  it("rejects blank portal, bad dates, and illegal stages", () => {
    const fixture = newFixture();
    seedOwnedOpportunity(fixture, "tenantA", {
      companyId: "google",
      opportunityId: "google-swe",
      role: "Software Engineer",
    });

    expect(() =>
      applyToOpportunity(fixture.client.db, fixture.tenantA, {
        opportunityId: "google-swe",
        portal: "  ",
        appliedOn: "2026-09-01",
      }),
    ).toThrowError(ApplicationInputError);
    expect(() =>
      applyToOpportunity(fixture.client.db, fixture.tenantA, {
        opportunityId: "google-swe",
        portal: "Greenhouse",
        appliedOn: "01-09-2026",
      }),
    ).toThrowError(ApplicationInputError);

    const created = applyToOpportunity(fixture.client.db, fixture.tenantA, {
      opportunityId: "google-swe",
      portal: "Greenhouse",
      appliedOn: "2026-09-01",
    });
    expect(() =>
      updateApplication(fixture.client.db, fixture.tenantA, created!.id, {
        stage: "ready_to_apply" as "applied",
      }),
    ).toThrowError(ApplicationInputError);
    expect(fixture.rowCount("application")).toBe(1);
  });


  it("keeps document usage in step with the version an application names", () => {
    const fixture = newFixture();
    seedOwnedOpportunity(fixture, "tenantA", {
      companyId: "microsoft",
      opportunityId: "ms-sde",
      role: "SDE",
    });
    createDocument(fixture.client.db, fixture.tenantA, {
      id: "doc-java",
      name: "Backend Java",
    });
    const v3 = storeDocumentVersion(
      fixture.client.db,
      fixture.tenantA,
      {
        id: "version-3",
        documentId: "doc-java",
        label: "v3",
        bytes: new Uint8Array([37, 80, 68, 70]),
        contentType: "application/pdf",
      },
      fixture.uploadsRoot,
    );
    const v4 = storeDocumentVersion(
      fixture.client.db,
      fixture.tenantA,
      {
        id: "version-4",
        documentId: "doc-java",
        label: "v4",
        bytes: new Uint8Array([37, 80, 68, 70, 10]),
        contentType: "application/pdf",
      },
      fixture.uploadsRoot,
    );

    const created = applyToOpportunity(fixture.client.db, fixture.tenantA, {
      id: "app-1",
      opportunityId: "ms-sde",
      portal: "Careers site",
      appliedOn: "2026-09-02",
      resumeVersionId: v3.id,
    });
    expect(created!.resumeVersionId).toBe("version-3");
    expect(
      countVersionUsage(fixture.client.db, fixture.tenantA, v3.id),
    ).toBe(1);

    // Deleting the version an application uses is refused, not a 500.
    expect(() =>
      deleteDocumentVersion(
        fixture.client.db,
        fixture.tenantA,
        v3.id,
        fixture.uploadsRoot,
      ),
    ).toThrow(DocumentInputError);

    // Moving to another version releases the old one.
    updateApplication(fixture.client.db, fixture.tenantA, "app-1", {
      resumeVersionId: v4.id,
    });
    expect(countVersionUsage(fixture.client.db, fixture.tenantA, v3.id)).toBe(0);
    expect(countVersionUsage(fixture.client.db, fixture.tenantA, v4.id)).toBe(1);

    // Clearing it releases that one too.
    updateApplication(fixture.client.db, fixture.tenantA, "app-1", {
      resumeVersionId: null,
    });
    expect(countVersionUsage(fixture.client.db, fixture.tenantA, v4.id)).toBe(0);
    deleteDocumentVersion(
      fixture.client.db,
      fixture.tenantA,
      v4.id,
      fixture.uploadsRoot,
    );
  });

  it("refuses to attach another workspace's document version", () => {
    const fixture = newFixture();
    seedOwnedOpportunity(fixture, "tenantA", {
      companyId: "microsoft",
      opportunityId: "ms-sde",
      role: "SDE",
    });
    createDocument(fixture.client.db, fixture.tenantB, {
      id: "doc-b",
      name: "Private Resume",
    });
    const theirs = storeDocumentVersion(
      fixture.client.db,
      fixture.tenantB,
      {
        id: "version-b",
        documentId: "doc-b",
        label: "v1",
        bytes: new Uint8Array([37, 80, 68, 70]),
        contentType: "application/pdf",
      },
      fixture.uploadsRoot,
    );

    expect(() =>
      applyToOpportunity(fixture.client.db, fixture.tenantA, {
        opportunityId: "ms-sde",
        portal: "Careers site",
        appliedOn: "2026-09-02",
        resumeVersionId: theirs.id,
      }),
    ).toThrow(ApplicationInputError);
    expect(fixture.rowCount("application")).toBe(0);
    expect(countVersionUsage(fixture.client.db, fixture.tenantB, theirs.id)).toBe(
      0,
    );
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { documentVersionLabel } from "../../domain/document";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { WORKSPACE_STORAGE_FULL } from "../../domain/document";
import {
  DocumentInputError,
  createDocument,
  deleteDocumentVersion,
  getDocumentVersion,
  listDocuments,
  readDocumentVersionFile,
  recordVersionUsage,
  storeDocumentVersion,
  workspaceStoredBytes,
} from "./documents";
import { applyToOpportunity } from "./applications";
import { createCompany } from "./companies";
import { createOpportunity } from "./opportunities";

const PDF = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37]);

describe("document repository", () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    const root = mkdtempSync(join(tmpdir(), "job-pilot-docs-"));
    cleanups.push(() => {
      fixture.dispose();
      rmSync(root, { force: true, recursive: true });
    });
    return { ...fixture, root };
  }

  function upload(
    fixture: ReturnType<typeof newFixture>,
    tenant: "tenantA" | "tenantB",
    input: { documentId: string; label: string; id?: string },
  ) {
    return storeDocumentVersion(
      fixture.client.db,
      fixture[tenant],
      {
        ...input,
        bytes: PDF,
        contentType: "application/pdf",
        originalFilename: "resume.pdf",
        now: new Date("2026-09-02T04:00:00.000Z"),
      },
      fixture.root,
    );
  }

  it("keeps two versions of one document and names them the §39 way", () => {
    const fixture = newFixture();
    createDocument(fixture.client.db, fixture.tenantA, {
      id: "doc-swe",
      name: "General SWE",
      kind: "resume",
    });

    const v4 = upload(fixture, "tenantA", {
      documentId: "doc-swe",
      label: "v4",
      id: "version-4",
    });
    const v5 = upload(fixture, "tenantA", {
      documentId: "doc-swe",
      label: "v5",
      id: "version-5",
    });

    expect(v4.storageKey).not.toBe(v5.storageKey);
    expect(documentVersionLabel("General SWE", v5.label)).toBe("General SWE v5");

    const documents = listDocuments(fixture.client.db, fixture.tenantA);
    expect(documents).toHaveLength(1);
    expect(documents[0].versions.map((version) => version.label)).toEqual([
      "v5",
      "v4",
    ]);
  });

  it("refuses a duplicate version label on the same document", () => {
    const fixture = newFixture();
    createDocument(fixture.client.db, fixture.tenantA, {
      id: "doc-swe",
      name: "General SWE",
    });
    upload(fixture, "tenantA", { documentId: "doc-swe", label: "v1" });

    expect(() =>
      upload(fixture, "tenantA", { documentId: "doc-swe", label: "v1" }),
    ).toThrow(DocumentInputError);
  });

  it("records the hash of the file it wrote, and backup verification agrees", async () => {
    // The real backup module, so the row and the file are checked the way a
    // restore checks them (D-026).
    const { readDocumentEntries, verifyDocumentEntries } = await import(
      "../../../scripts/backup/documents.mjs"
    );
    const fixture = newFixture();
    createDocument(fixture.client.db, fixture.tenantA, {
      id: "doc-java",
      name: "Backend Java",
    });
    const version = upload(fixture, "tenantA", {
      documentId: "doc-java",
      label: "v3",
      id: "version-java-3",
    });

    expect(version.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(version.byteSize).toBe(PDF.byteLength);

    const entries = readDocumentEntries(fixture.client.sqlite);
    expect(entries.present).toBe(true);
    const { verified, problems } = verifyDocumentEntries(
      entries.entries,
      fixture.root,
    ) as {
      verified: Record<string, { sha256: string; bytes: number }>;
      problems: string[];
    };
    expect(problems).toEqual([]);
    expect(verified["version-java-3"].sha256).toBe(version.sha256);

    // Corrupt the file and the same verification must now object.
    writeFileSync(join(fixture.root, version.storageKey), "tampered");
    expect(
      verifyDocumentEntries(entries.entries, fixture.root).problems,
    ).toHaveLength(1);
  });

  it("refuses to delete a version an application is using", () => {
    const fixture = newFixture();
    createDocument(fixture.client.db, fixture.tenantA, {
      id: "doc-java",
      name: "Backend Java",
    });
    const version = upload(fixture, "tenantA", {
      documentId: "doc-java",
      label: "v3",
      id: "version-java-3",
    });
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "ms-sde",
      companyId: "microsoft",
      role: "SDE",
    });
    applyToOpportunity(fixture.client.db, fixture.tenantA, {
      id: "app-1",
      opportunityId: "ms-sde",
      portal: "Careers site",
      appliedOn: "2026-09-02",
      resumeVersionId: version.id,
    });
    recordVersionUsage(fixture.client.db, fixture.tenantA, {
      versionId: version.id,
      entityType: "application",
      entityId: "app-1",
    });

    expect(() =>
      deleteDocumentVersion(
        fixture.client.db,
        fixture.tenantA,
        version.id,
        fixture.root,
      ),
    ).toThrow(DocumentInputError);
    // The file is still there: a refused delete removes nothing.
    expect(
      readDocumentVersionFile(
        fixture.client.db,
        fixture.tenantA,
        version.id,
        fixture.root,
      ),
    ).not.toBeUndefined();
  });

  it("deletes an unused version and its file together", () => {
    const fixture = newFixture();
    createDocument(fixture.client.db, fixture.tenantA, {
      id: "doc-java",
      name: "Backend Java",
    });
    const version = upload(fixture, "tenantA", {
      documentId: "doc-java",
      label: "v3",
      id: "version-java-3",
    });

    deleteDocumentVersion(
      fixture.client.db,
      fixture.tenantA,
      version.id,
      fixture.root,
    );

    expect(
      getDocumentVersion(fixture.client.db, fixture.tenantA, version.id),
    ).toBeUndefined();
    expect(
      readDocumentVersionFile(
        fixture.client.db,
        fixture.tenantA,
        version.id,
        fixture.root,
      ),
    ).toBeUndefined();
  });

  it("hides one workspace's documents, files and usage from another", () => {
    const fixture = newFixture();
    createDocument(fixture.client.db, fixture.tenantA, {
      id: "doc-a",
      name: "Backend Java",
    });
    createDocument(fixture.client.db, fixture.tenantB, {
      id: "doc-b",
      name: "Private Resume",
    });
    const versionA = upload(fixture, "tenantA", {
      documentId: "doc-a",
      label: "v3",
      id: "version-a",
    });

    expect(listDocuments(fixture.client.db, fixture.tenantB)).toEqual([
      expect.objectContaining({ name: "Private Resume", versions: [] }),
    ]);

    // B holds a valid session and A's real version id: not found, no file.
    expect(
      getDocumentVersion(fixture.client.db, fixture.tenantB, versionA.id),
    ).toBeUndefined();
    expect(
      readDocumentVersionFile(
        fixture.client.db,
        fixture.tenantB,
        versionA.id,
        fixture.root,
      ),
    ).toBeUndefined();
    expect(() =>
      deleteDocumentVersion(
        fixture.client.db,
        fixture.tenantB,
        versionA.id,
        fixture.root,
      ),
    ).toThrow(DocumentInputError);

    // B cannot attach A's version to B's own application either.
    createCompany(fixture.client.db, fixture.tenantB, {
      id: "company-b",
      name: "Other Co",
    });
    createOpportunity(fixture.client.db, fixture.tenantB, {
      id: "opp-b",
      companyId: "company-b",
      role: "SDE",
    });
    applyToOpportunity(fixture.client.db, fixture.tenantB, {
      id: "app-b",
      opportunityId: "opp-b",
      portal: "Careers site",
      appliedOn: "2026-09-02",
    });
    expect(() =>
      recordVersionUsage(fixture.client.db, fixture.tenantB, {
        versionId: versionA.id,
        entityType: "application",
        entityId: "app-b",
      }),
    ).toThrow(DocumentInputError);

    // A's own row is untouched by all of that.
    expect(
      getDocumentVersion(fixture.client.db, fixture.tenantA, versionA.id),
    ).toMatchObject({ label: "v3" });
  });

  it("refuses an unsupported type and an oversized file", () => {
    const fixture = newFixture();
    createDocument(fixture.client.db, fixture.tenantA, {
      id: "doc-a",
      name: "Backend Java",
    });

    expect(() =>
      storeDocumentVersion(
        fixture.client.db,
        fixture.tenantA,
        {
          documentId: "doc-a",
          label: "v1",
          bytes: PDF,
          contentType: "application/x-msdownload",
        },
        fixture.root,
      ),
    ).toThrow(DocumentInputError);

    expect(() =>
      storeDocumentVersion(
        fixture.client.db,
        fixture.tenantA,
        {
          documentId: "doc-a",
          label: "v1",
          bytes: new Uint8Array(11 * 1024 * 1024),
          contentType: "application/pdf",
        },
        fixture.root,
      ),
    ).toThrow(DocumentInputError);

    expect(listDocuments(fixture.client.db, fixture.tenantA)[0].versions).toEqual(
      [],
    );
  });

  it("stops one workspace filling the disk, and says so", () => {
    const fixture = newFixture();
    // Real PDF bytes: content sniffing runs before the quota does.
    const bigPdf = (megabytes: number) => {
      const buffer = new Uint8Array(megabytes * 1024 * 1024);
      buffer.set(PDF, 0);
      return buffer;
    };
    createDocument(fixture.client.db, fixture.tenantA, {
      id: "doc-a",
      name: "Backend Java",
    });

    // Two 8 MB uploads fit inside the cap; the eleventh would pass it.
    for (let index = 0; index < 25; index += 1) {
      storeDocumentVersion(
        fixture.client.db,
        fixture.tenantA,
        {
          documentId: "doc-a",
          label: `v${index + 1}`,
          bytes: bigPdf(8),
          contentType: "application/pdf",
        },
        fixture.root,
      );
    }

    expect(
      workspaceStoredBytes(fixture.client.db, fixture.tenantA),
    ).toBe(25 * 8 * 1024 * 1024);
    expect(() =>
      storeDocumentVersion(
        fixture.client.db,
        fixture.tenantA,
        {
          documentId: "doc-a",
          label: "v26",
          bytes: bigPdf(8),
          contentType: "application/pdf",
        },
        fixture.root,
      ),
    ).toThrow(WORKSPACE_STORAGE_FULL);

    // Another workspace still has its own full allowance.
    createDocument(fixture.client.db, fixture.tenantB, {
      id: "doc-b",
      name: "Their Resume",
    });
    expect(() =>
      storeDocumentVersion(
        fixture.client.db,
        fixture.tenantB,
        {
          documentId: "doc-b",
          label: "v1",
          bytes: new Uint8Array([37, 80, 68, 70]),
          contentType: "application/pdf",
        },
        fixture.root,
      ),
    ).not.toThrow();
  });
});

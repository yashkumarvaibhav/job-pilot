import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DOCUMENT_EMPTY,
  DOCUMENT_ERROR,
  DOCUMENT_LOADING,
} from "../domain/document";
import { applyToOpportunity } from "../server/repos/applications";
import { createCompany } from "../server/repos/companies";
import {
  createDocument,
  storeDocumentVersion,
} from "../server/repos/documents";
import { createOpportunity } from "../server/repos/opportunities";
import { createTenantTestFixture } from "../test/tenant-fixture";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: undefined as unknown,
  pathname: "/settings/documents",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => mocks.pathname,
}));
vi.mock("@/server/auth/current-session", () => ({
  requireTenant: async () => mocks.tenant,
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));

import DocumentsPage from "./(app)/settings/documents/page";
import DocumentsError from "./(app)/settings/documents/error";
import DocumentsLoading from "./(app)/settings/documents/loading";
import ApplicationsPage from "./(app)/applications/page";
import SettingsLayout from "./(app)/settings/layout";

describe("documents screen", () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  beforeEach(() => {
    mocks.database = undefined;
    mocks.tenant = undefined;
    mocks.pathname = "/settings/documents";
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    const root = mkdtempSync(join(tmpdir(), "job-pilot-doc-ui-"));
    process.env.UPLOADS_ROOT = root;
    cleanups.push(() => {
      fixture.dispose();
      rmSync(root, { force: true, recursive: true });
      delete process.env.UPLOADS_ROOT;
    });
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
    return { ...fixture, root };
  }

  function seedVersion(
    fixture: ReturnType<typeof newFixture>,
    tenant: "tenantA" | "tenantB" = "tenantA",
    name = "Backend Java",
  ) {
    createDocument(fixture.client.db, fixture[tenant], {
      id: `doc-${tenant}`,
      name,
    });
    return storeDocumentVersion(
      fixture.client.db,
      fixture[tenant],
      {
        id: `version-${tenant}`,
        documentId: `doc-${tenant}`,
        label: "v3",
        bytes: new Uint8Array([37, 80, 68, 70]),
        contentType: "application/pdf",
        originalFilename: "backend-java-v3.pdf",
      },
      fixture.root,
    );
  }

  it("names the empty state and offers a document form, not a bare file input", async () => {
    newFixture();

    const html = renderToStaticMarkup(await DocumentsPage());

    expect(html).toContain(DOCUMENT_EMPTY);
    expect(html).toContain("Add document");
    expect(html).toContain("Document name");
  });

  it("lists a stored version by its §39 name with a download link", async () => {
    const fixture = newFixture();
    seedVersion(fixture);

    const html = renderToStaticMarkup(await DocumentsPage());

    expect(html).toContain("Backend Java v3");
    expect(html).toContain("/api/document-versions/version-tenantA/file");
    expect(html).toContain("backend-java-v3.pdf");
    expect(html).toContain("Not used");
    expect(html).toContain("Upload version");
    // Stacked cards exist alongside the table for narrow viewports.
    expect(html).toContain("document-card-list");
    expect(html).toContain("document-table-wrap");
  });

  it("shows another workspace nothing of the first one's documents", async () => {
    const fixture = newFixture();
    seedVersion(fixture, "tenantB", "Private Resume");

    const html = renderToStaticMarkup(await DocumentsPage());

    expect(html).toContain(DOCUMENT_EMPTY);
    expect(html).not.toContain("Private Resume");
    expect(html).not.toContain("version-tenantB");
  });

  it("names the version an application used, not its id", async () => {
    const fixture = newFixture();
    const version = seedVersion(fixture);
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

    const html = renderToStaticMarkup(await ApplicationsPage());

    expect(html).toContain("Backend Java v3");
    expect(html).not.toContain(">version-tenantA<");

    // And the version now reads as in use on the documents screen.
    expect(renderToStaticMarkup(await DocumentsPage())).toContain(
      "1 application",
    );
  });

  it("designs its loading and error states", () => {
    expect(renderToStaticMarkup(<DocumentsLoading />)).toContain(
      DOCUMENT_LOADING,
    );
    expect(
      renderToStaticMarkup(<DocumentsError reset={() => undefined} />),
    ).toContain(DOCUMENT_ERROR);
  });

  it("adds Documents to the settings sub-nav", () => {
    const html = renderToStaticMarkup(
      SettingsLayout({ children: <p>body</p> }),
    );

    expect(html).toContain('href="/settings/documents"');
    expect(html).toContain('aria-current="page"');
  });

  it("styles the document surface for narrow viewports in tokens only", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

    expect(css).toContain(".document-card-list");
    expect(css).toContain(".document-table-wrap");
    expect(css).toContain("min-height: var(--target-min)");
    expect(/\.document-[a-z-]*\s*\{[^}]*#[0-9a-fA-F]{3}/.test(css)).toBe(false);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../../../test/tenant-fixture";
import { applyToOpportunity } from "../../../server/repos/applications";
import { createCompany } from "../../../server/repos/companies";
import {
  createDocument,
  recordVersionUsage,
} from "../../../server/repos/documents";
import { createOpportunity } from "../../../server/repos/opportunities";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: undefined as unknown,
}));

vi.mock("@/server/auth/current-session", () => ({
  currentTenant: async () => mocks.tenant,
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));

import { GET, POST } from "./route";
import { POST as uploadVersion } from "./[id]/versions/route";
import { DELETE as deleteVersion } from "../document-versions/[versionId]/route";
import { GET as downloadFile } from "../document-versions/[versionId]/file/route";

const HOST = "https://jobpilot.invalid.test";
const PDF_BYTES = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10]);

function uploadRequest(label: string, type = "application/pdf") {
  const form = new FormData();
  form.set("label", label);
  form.set("file", new File([PDF_BYTES], "resume.pdf", { type }));
  return new Request(`${HOST}/api/documents/doc-1/versions`, {
    method: "POST",
    body: form,
  });
}

describe("document route handlers", () => {
  const cleanups: (() => void)[] = [];
  let previousRoot: string | undefined;

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    if (previousRoot === undefined) {
      delete process.env.UPLOADS_ROOT;
    } else {
      process.env.UPLOADS_ROOT = previousRoot;
    }
  });

  beforeEach(() => {
    mocks.database = undefined;
    mocks.tenant = undefined;
    previousRoot = process.env.UPLOADS_ROOT;
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    const root = mkdtempSync(join(tmpdir(), "job-pilot-doc-routes-"));
    process.env.UPLOADS_ROOT = root;
    cleanups.push(() => {
      fixture.dispose();
      rmSync(root, { force: true, recursive: true });
    });
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
    return { ...fixture, root };
  }

  async function seedVersion(fixture: ReturnType<typeof newFixture>) {
    createDocument(fixture.client.db, fixture.tenantA, {
      id: "doc-1",
      name: "Backend Java",
    });
    const response = await uploadVersion(uploadRequest("v3"), {
      params: Promise.resolve({ id: "doc-1" }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string; downloadUrl: string };
  }

  it("refuses every verb without a session", async () => {
    const fixture = newFixture();
    createDocument(fixture.client.db, fixture.tenantA, {
      id: "doc-1",
      name: "Backend Java",
    });
    mocks.tenant = null;

    expect((await GET()).status).toBe(401);
    expect(
      (
        await POST(
          new Request(`${HOST}/api/documents`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Sneaky" }),
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await uploadVersion(uploadRequest("v1"), {
          params: Promise.resolve({ id: "doc-1" }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await downloadFile(new Request(`${HOST}/f`), {
          params: Promise.resolve({ versionId: "anything" }),
        })
      ).status,
    ).toBe(401);
  });

  it("uploads a version and serves its bytes back to the owning session", async () => {
    const fixture = newFixture();
    const version = await seedVersion(fixture);

    const file = await downloadFile(new Request(`${HOST}/f`), {
      params: Promise.resolve({ versionId: version.id }),
    });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(file.headers.get("content-disposition")).toBe(
      'attachment; filename="resume.pdf"',
    );
    expect(file.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it("gives another workspace a 404, not the file and not a 403", async () => {
    const fixture = newFixture();
    const version = await seedVersion(fixture);

    mocks.tenant = fixture.tenantB;

    const file = await downloadFile(new Request(`${HOST}/f`), {
      params: Promise.resolve({ versionId: version.id }),
    });
    expect(file.status).toBe(404);
    expect(await file.json()).toEqual({ error: "Document version not found" });

    const removed = await deleteVersion(new Request(`${HOST}/d`), {
      params: Promise.resolve({ versionId: version.id }),
    });
    expect(removed.status).toBe(404);

    const upload = await uploadVersion(uploadRequest("v4"), {
      params: Promise.resolve({ id: "doc-1" }),
    });
    expect(upload.status).toBe(404);

    const listed = await GET();
    expect(await listed.json()).toEqual({ documents: [] });
  });

  it("explains a refused delete instead of failing with a 500", async () => {
    const fixture = newFixture();
    const version = await seedVersion(fixture);
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

    const response = await deleteVersion(new Request(`${HOST}/d`), {
      params: Promise.resolve({ versionId: version.id }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Detach it there");

    // Still downloadable: nothing was removed.
    expect(
      (
        await downloadFile(new Request(`${HOST}/f`), {
          params: Promise.resolve({ versionId: version.id }),
        })
      ).status,
    ).toBe(200);
  });

  it("refuses an unsupported file type with a sentence", async () => {
    const fixture = newFixture();
    createDocument(fixture.client.db, fixture.tenantA, {
      id: "doc-1",
      name: "Backend Java",
    });

    const response = await uploadVersion(
      uploadRequest("v1", "application/x-msdownload"),
      { params: Promise.resolve({ id: "doc-1" }) },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("PDF");
  });

  it("creates a document and rejects an unknown kind", async () => {
    newFixture();

    const created = await POST(
      new Request(`${HOST}/api/documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "General SWE", kind: "resume" }),
      }),
    );
    expect(created.status).toBe(201);

    const bad = await POST(
      new Request(`${HOST}/api/documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Odd", kind: "spreadsheet" }),
      }),
    );
    expect(bad.status).toBe(400);
  });
});

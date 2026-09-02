import { describe, expect, it } from "vitest";

import {
  ALLOWED_UPLOAD_TYPES,
  DOCUMENT_KINDS,
  UPLOAD_MAX_BYTES,
  documentKindLabel,
  documentVersionLabel,
  formatFileSize,
  isAllowedUploadType,
  isDocumentKind,
  storageKeyFor,
  suggestedVersionLabel,
  uploadExtensionFor,
} from "./document";

describe("document domain", () => {
  it("covers §39's document categories and rejects anything else", () => {
    for (const kind of [
      "resume",
      "cover_letter",
      "transcript",
      "degree_certificate",
      "portfolio",
      "research_cv",
      "writing_sample",
      "generic",
    ]) {
      expect(isDocumentKind(kind)).toBe(true);
    }
    expect(isDocumentKind("spreadsheet")).toBe(false);
    expect(DOCUMENT_KINDS).toHaveLength(8);
    expect(documentKindLabel("cover_letter")).toBe("Cover letter");
    expect(documentKindLabel("unknown")).toBe("unknown");
  });

  it("names a version the way §39 writes them", () => {
    expect(documentVersionLabel("Backend Java", "v3")).toBe("Backend Java v3");
    expect(documentVersionLabel(" General SWE ", " v5 ")).toBe("General SWE v5");
    expect(suggestedVersionLabel([])).toBe("v1");
    expect(suggestedVersionLabel(["v1", "v2"])).toBe("v3");
    // A document whose first upload was already v3 suggests v4, not v2.
    expect(suggestedVersionLabel(["v3"])).toBe("v4");
    expect(suggestedVersionLabel(["Draft", "v9", "v2"])).toBe("v10");
    expect(suggestedVersionLabel(["Draft"])).toBe("v2");
  });

  it("allows only the declared upload types, case-insensitively", () => {
    expect(isAllowedUploadType("application/pdf")).toBe(true);
    expect(isAllowedUploadType("APPLICATION/PDF")).toBe(true);
    expect(isAllowedUploadType(" application/pdf ")).toBe(true);
    expect(uploadExtensionFor("image/jpeg")).toBe("jpg");

    for (const refused of [
      "application/x-msdownload",
      "text/html",
      "application/octet-stream",
      "",
    ]) {
      expect(isAllowedUploadType(refused)).toBe(false);
      expect(uploadExtensionFor(refused)).toBeNull();
    }

    // Every allowlisted type has an extension the storage key can use.
    for (const type of ALLOWED_UPLOAD_TYPES) {
      expect(uploadExtensionFor(type.contentType)).toBe(type.extension);
    }
  });

  it("builds a workspace-scoped storage key from ids, never a filename", () => {
    expect(storageKeyFor("workspace-a", "version-1", "pdf")).toBe(
      "workspace-a/version-1.pdf",
    );
    // Nothing the browser sent reaches the path.
    expect(storageKeyFor("workspace-a", "version-1", "pdf")).not.toContain(
      "resume",
    );
  });

  it("formats sizes for a dense table and caps uploads at 10 MB", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1024 * 1024 * 3)).toBe("3.0 MB");
    expect(UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});

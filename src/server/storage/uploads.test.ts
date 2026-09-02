import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_UPLOADS_DIRECTORY,
  UploadStorageError,
  deleteStoredFile,
  readStoredFile,
  resolveStoredPath,
  uploadsRoot,
  writeStoredFile,
} from "./uploads";

describe("upload storage", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  function newRoot() {
    const directory = mkdtempSync(join(tmpdir(), "job-pilot-uploads-"));
    directories.push(directory);
    return directory;
  }

  it("defaults under the app root and honours an explicit override", () => {
    expect(uploadsRoot({}, "/srv/app")).toBe(
      join("/srv/app", DEFAULT_UPLOADS_DIRECTORY.replace("./", "")),
    );
    expect(uploadsRoot({ UPLOADS_ROOT: "./var/demo/uploads" }, "/srv/app")).toBe(
      "/srv/app/var/demo/uploads",
    );
  });

  it("refuses any key that would leave the uploads root", () => {
    const root = newRoot();

    for (const key of [
      "../escape.pdf",
      "/etc/passwd",
      "workspace/../../escape.pdf",
      "",
      "   ",
    ]) {
      expect(() => resolveStoredPath(root, key)).toThrow(UploadStorageError);
    }

    expect(resolveStoredPath(root, "workspace-a/version-1.pdf")).toBe(
      join(root, "workspace-a", "version-1.pdf"),
    );
  });

  it("writes bytes, hashes what it wrote, and reads them back", () => {
    const root = newRoot();
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);

    const stored = writeStoredFile(root, "workspace-a/version-1.pdf", bytes);

    expect(stored.byteSize).toBe(8);
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(root, "workspace-a", "version-1.pdf"))).toEqual(
      Buffer.from(bytes),
    );
    expect(readStoredFile(root, "workspace-a/version-1.pdf")).toEqual(
      Buffer.from(bytes),
    );

    // The digest is of the file on disk, which is what backup verification reads.
    expect(stored.sha256).toBe(
      createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
    );
  });

  it("deletes a stored file and treats a second delete as done", () => {
    const root = newRoot();
    writeStoredFile(root, "workspace-a/version-1.pdf", new Uint8Array([1, 2]));

    deleteStoredFile(root, "workspace-a/version-1.pdf");
    deleteStoredFile(root, "workspace-a/version-1.pdf");

    expect(() => readStoredFile(root, "workspace-a/version-1.pdf")).toThrow(
      UploadStorageError,
    );
  });
});

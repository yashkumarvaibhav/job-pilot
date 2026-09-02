import { describe, expect, it } from "vitest";

import {
  CONTENT_MISMATCH_REFUSED,
  contentMatchesDeclaredType,
  sniffContentType,
} from "./file-signature";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0);
const DOCX = bytes(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0);
const DOC = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
const WINDOWS_EXE = bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0);
const LINUX_ELF = bytes(0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00);
const TEXT = new TextEncoder().encode("Yash Kumar Vaibhav\nIIIT Delhi\n");

describe("file signatures", () => {
  it("recognises the formats the upload allow-list accepts", () => {
    expect(sniffContentType(PDF)).toBe("application/pdf");
    expect(sniffContentType(PNG)).toBe("image/png");
    expect(sniffContentType(JPEG)).toBe("image/jpeg");
    expect(sniffContentType(DOC)).toBe("application/msword");
    expect(sniffContentType(DOCX)).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(sniffContentType(TEXT)).toBe("text/plain");
  });

  it("does not recognise an executable as anything", () => {
    expect(sniffContentType(WINDOWS_EXE)).toBeNull();
    expect(sniffContentType(LINUX_ELF)).toBeNull();
  });

  it("refuses a .exe renamed to .pdf, on its content and not its name", () => {
    // Exactly the owner check: the browser reports application/pdf for a file
    // called resume.pdf whatever is inside it.
    expect(contentMatchesDeclaredType("application/pdf", WINDOWS_EXE)).toBe(
      false,
    );
    expect(contentMatchesDeclaredType("application/pdf", PDF)).toBe(true);
  });

  it("refuses a real file of the wrong declared type", () => {
    expect(contentMatchesDeclaredType("application/pdf", PNG)).toBe(false);
    expect(contentMatchesDeclaredType("image/png", PDF)).toBe(false);
    expect(contentMatchesDeclaredType("image/png", PNG)).toBe(true);
  });

  it("treats a Word file and its zip container as the same thing", () => {
    expect(
      contentMatchesDeclaredType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        DOCX,
      ),
    ).toBe(true);
  });

  it("accepts real text and rejects binary claiming to be text", () => {
    expect(contentMatchesDeclaredType("text/plain", TEXT)).toBe(true);
    expect(contentMatchesDeclaredType("text/plain", WINDOWS_EXE)).toBe(false);
    expect(
      contentMatchesDeclaredType("text/plain", bytes(0x68, 0x00, 0x69)),
    ).toBe(false);
    // A UTF-8 BOM and a byte-order-free unicode name are both still text.
    expect(
      contentMatchesDeclaredType(
        "text/plain",
        new TextEncoder().encode("﻿नमस्ते\n"),
      ),
    ).toBe(true);
  });

  it("refuses an empty or truncated file rather than guessing", () => {
    expect(sniffContentType(bytes())).toBeNull();
    expect(contentMatchesDeclaredType("application/pdf", bytes(0x25))).toBe(
      false,
    );
  });

  it("has copy that names the problem without teaching the bypass", () => {
    expect(CONTENT_MISMATCH_REFUSED).toMatch(/content/i);
    expect(CONTENT_MISMATCH_REFUSED).not.toMatch(/magic|signature|byte/i);
  });
});

/**
 * What a file actually is, from its leading bytes (§62, D-022).
 *
 * The type a browser reports is derived from the file's extension, so a `.exe`
 * renamed to `.pdf` arrives declared as `application/pdf`. The allow-list in
 * `document.ts` decides what Job Pilot is willing to store; this decides
 * whether the bytes are that thing.
 */

export const CONTENT_MISMATCH_REFUSED =
  "That file's content does not match its type. Upload the original file.";

type Signature = {
  contentType: string;
  magic: readonly number[];
};

const SIGNATURES: readonly Signature[] = [
  { contentType: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  {
    contentType: "image/png",
    magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { contentType: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  {
    contentType: "application/msword",
    magic: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  },
  {
    // .docx is a zip; the container is as far as a signature can go.
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    magic: [0x50, 0x4b, 0x03, 0x04],
  },
];

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return (
    bytes.length >= magic.length &&
    magic.every((value, index) => bytes[index] === value)
  );
}

/** Anything but tab, newline and carriage return; NUL included. */
const CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

/** Bytes that decode as UTF-8 and carry no NUL or stray control characters. */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return false;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  // Tab, newline and carriage return are the only control characters expected.
  return !CONTROL_CHARACTERS.test(text);
}

export function sniffContentType(bytes: Uint8Array): string | null {
  for (const signature of SIGNATURES) {
    if (startsWith(bytes, signature.magic)) {
      return signature.contentType;
    }
  }
  return looksLikeText(bytes) ? "text/plain" : null;
}

/**
 * `true` only when the bytes really are the declared type. Text is the one type
 * without a signature, so it is judged by decoding rather than by a prefix —
 * which is also what stops an executable being stored as a "text" file.
 */
export function contentMatchesDeclaredType(
  declared: string,
  bytes: Uint8Array,
): boolean {
  const normalized = declared.trim().toLowerCase();
  const actual = sniffContentType(bytes);
  if (actual === null) {
    return false;
  }
  if (normalized === "text/plain") {
    // A PDF decodes as bytes, not as text, so this stays honest both ways.
    return actual === "text/plain";
  }
  return actual === normalized;
}

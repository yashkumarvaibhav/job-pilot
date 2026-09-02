/**
 * §39's document manager. A document is a reusable thing ("Backend Java"); a
 * version is one uploaded file of it ("v3"). An application records exactly
 * which version it used, so the version — not the document — is the unit
 * everything else points at.
 */

export const DOCUMENT_KINDS = [
  { value: "resume", label: "Resume" },
  { value: "cover_letter", label: "Cover letter" },
  { value: "transcript", label: "Transcript" },
  { value: "degree_certificate", label: "Degree certificate" },
  { value: "portfolio", label: "Portfolio" },
  { value: "research_cv", label: "Research CV" },
  { value: "writing_sample", label: "Writing sample" },
  { value: "generic", label: "Generic document" },
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number]["value"];

export const DEFAULT_DOCUMENT_KIND: DocumentKind = "resume";

export const DOCUMENT_KIND_VALUES = DOCUMENT_KINDS.map((kind) => kind.value);

export function isDocumentKind(value: string): value is DocumentKind {
  return (DOCUMENT_KIND_VALUES as readonly string[]).includes(value);
}

export function documentKindLabel(value: string): string {
  return DOCUMENT_KINDS.find((kind) => kind.value === value)?.label ?? value;
}

/** How every screen names one version: "Backend Java v3". */
export function documentVersionLabel(
  documentName: string,
  versionLabel: string,
): string {
  return `${documentName.trim()} ${versionLabel.trim()}`.trim();
}

/** The next label to suggest for a document that already has `count` versions. */
export function suggestedVersionLabel(count: number): string {
  return `v${count + 1}`;
}

export const DOCUMENT_EMPTY =
  "No documents yet. Upload a resume version to attach it to an application.";

export const DOCUMENT_ERROR = "Could not load documents";

export const DOCUMENT_LOADING = "Loading documents";

export const DOCUMENT_VERSION_IN_USE =
  "This version is recorded on an application. Detach it there before deleting it.";

export const DOCUMENT_NO_VERSION_LABEL = "No version recorded";

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/**
 * A small allowlist rather than a sniffing library: the product needs resumes and
 * transcripts, and an unknown type is a refusal, not a guess.
 */
export const ALLOWED_UPLOAD_TYPES = [
  { contentType: "application/pdf", extension: "pdf" },
  {
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  },
  { contentType: "application/msword", extension: "doc" },
  { contentType: "text/plain", extension: "txt" },
  { contentType: "image/png", extension: "png" },
  { contentType: "image/jpeg", extension: "jpg" },
] as const;

export function uploadExtensionFor(contentType: string): string | null {
  return (
    ALLOWED_UPLOAD_TYPES.find(
      (type) => type.contentType === contentType.trim().toLowerCase(),
    )?.extension ?? null
  );
}

export function isAllowedUploadType(contentType: string): boolean {
  return uploadExtensionFor(contentType) !== null;
}

export const UPLOAD_TYPE_REFUSED = `Upload a PDF, Word file, text file or image. Other types are not stored.`;

export const UPLOAD_TOO_LARGE = `That file is larger than ${
  UPLOAD_MAX_BYTES / (1024 * 1024)
} MB.`;

/**
 * The stored path, relative to the uploads root. Never the name the browser sent:
 * the workspace prefix keeps one tenant's files in one directory and the version
 * id makes the name unguessable and collision-free.
 */
export function storageKeyFor(
  workspaceId: string,
  versionId: string,
  extension: string,
): string {
  return `${workspaceId}/${versionId}.${extension}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

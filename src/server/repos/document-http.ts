import {
  documentVersionLabel,
  formatFileSize,
  isDocumentKind,
} from "../../domain/document";
import type { DocumentVersionRow, DocumentWithVersions } from "./documents";

const CREATE_FIELDS = ["name", "kind", "notes"] as const;

async function readObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return null;
  }
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function readCreateDocumentInput(
  request: Request,
): Promise<{ name: string; kind?: string; notes?: string } | null> {
  const body = await readObject(request);
  if (!body) {
    return null;
  }
  const allowed = new Set<string>(CREATE_FIELDS);
  if (!Object.keys(body).every((key) => allowed.has(key))) {
    return null;
  }
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return null;
  }
  if (body.kind !== undefined && typeof body.kind !== "string") {
    return null;
  }
  if (body.kind !== undefined && !isDocumentKind(body.kind)) {
    return null;
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    return null;
  }
  return {
    name: body.name,
    kind: body.kind as string | undefined,
    notes: body.notes as string | undefined,
  };
}

export type UploadInput = {
  label: string;
  bytes: Uint8Array;
  contentType: string;
  originalFilename: string | null;
};

/**
 * Multipart, because this is a file. The browser's declared type is what the
 * allowlist is checked against; the size limit is enforced on the bytes read.
 */
export async function readUploadInput(
  request: Request,
): Promise<UploadInput | null> {
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    return null;
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return null;
  }
  const file = form.get("file");
  const label = form.get("label");
  if (!(file instanceof File) || typeof label !== "string") {
    return null;
  }
  if (label.trim().length === 0) {
    return null;
  }
  return {
    label,
    bytes: new Uint8Array(await file.arrayBuffer()),
    contentType: file.type,
    originalFilename: file.name.trim().length > 0 ? file.name : null,
  };
}

export function versionResponse(
  row: DocumentVersionRow & { usageCount?: number },
  documentName?: string,
) {
  return {
    id: row.id,
    documentId: row.documentId,
    label: row.label,
    displayName: documentName
      ? documentVersionLabel(documentName, row.label)
      : row.label,
    sha256: row.sha256,
    byteSize: row.byteSize,
    size: formatFileSize(row.byteSize),
    contentType: row.contentType,
    originalFilename: row.originalFilename,
    createdAt: row.createdAt.toISOString(),
    usageCount: row.usageCount ?? 0,
    downloadUrl: `/api/document-versions/${row.id}/file`,
  };
}

export function documentResponse(row: DocumentWithVersions) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    versions: row.versions.map((version) => versionResponse(version, row.name)),
  };
}

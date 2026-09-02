import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import {
  DEFAULT_DOCUMENT_KIND,
  DOCUMENT_VERSION_IN_USE,
  UPLOAD_MAX_BYTES,
  UPLOAD_TOO_LARGE,
  UPLOAD_TYPE_REFUSED,
  isDocumentKind,
  storageKeyFor,
  uploadExtensionFor,
  type DocumentKind,
} from "../../domain/document";
import { logEvent } from "../db/activity";
import type { AppDatabase } from "../db/client";
import { document, documentUsage, documentVersion } from "../db/schema";
import type { TenantContext } from "../db/tenant";
import {
  deleteStoredFile,
  readStoredFile,
  storedFileExists,
  uploadsRoot,
  writeStoredFile,
} from "../storage/uploads";

export type DocumentRow = typeof document.$inferSelect;
export type DocumentVersionRow = typeof documentVersion.$inferSelect;

export type DocumentWithVersions = DocumentRow & {
  versions: (DocumentVersionRow & { usageCount: number })[];
};

export type CreateDocumentInput = {
  id?: string;
  name: string;
  kind?: string;
  notes?: string | null;
  now?: Date;
};

export type StoreDocumentVersionInput = {
  id?: string;
  documentId: string;
  label: string;
  bytes: Uint8Array;
  contentType: string;
  originalFilename?: string | null;
  now?: Date;
};

export type RecordVersionUsageInput = {
  versionId: string;
  entityType: "application";
  entityId: string;
  now?: Date;
};

export class DocumentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentInputError";
  }
}

function requiredText(value: string, label: string): string {
  const normalized = (value ?? "").trim();
  if (normalized.length === 0) {
    throw new DocumentInputError(`${label} is required.`);
  }
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function createDocument(
  database: AppDatabase,
  tenant: TenantContext,
  input: CreateDocumentInput,
): DocumentRow {
  const name = requiredText(input.name, "Document name");
  const kind = input.kind ?? DEFAULT_DOCUMENT_KIND;
  if (!isDocumentKind(kind)) {
    throw new DocumentInputError(`${kind} is not a document type.`);
  }
  const now = input.now ?? new Date();

  return database.transaction((transaction) => {
    const existing = transaction
      .select()
      .from(document)
      .where(
        and(
          eq(document.workspaceId, tenant.workspaceId),
          eq(document.name, name),
        ),
      )
      .get();
    if (existing) {
      throw new DocumentInputError(`${name} already exists in this workspace.`);
    }

    const row = transaction
      .insert(document)
      .values({
        id: input.id ?? randomUUID(),
        workspaceId: tenant.workspaceId,
        name,
        kind: kind as DocumentKind,
        notes: optionalText(input.notes),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    logEvent(transaction, tenant, {
      at: now,
      kind: "DOCUMENT_CREATED",
      entityType: "document",
      entityId: row.id,
      payload: { name: row.name, kind: row.kind },
    });
    return row;
  });
}

export function listDocuments(
  database: AppDatabase,
  tenant: TenantContext,
): DocumentWithVersions[] {
  const documents = database
    .select()
    .from(document)
    .where(eq(document.workspaceId, tenant.workspaceId))
    .orderBy(document.name)
    .all();
  const versions = database
    .select()
    .from(documentVersion)
    .where(eq(documentVersion.workspaceId, tenant.workspaceId))
    .orderBy(desc(documentVersion.createdAt), desc(documentVersion.label))
    .all();
  const usage = database
    .select()
    .from(documentUsage)
    .where(eq(documentUsage.workspaceId, tenant.workspaceId))
    .all();

  const usageByVersion = new Map<string, number>();
  for (const row of usage) {
    usageByVersion.set(row.versionId, (usageByVersion.get(row.versionId) ?? 0) + 1);
  }

  return documents.map((row) => ({
    ...row,
    versions: versions
      .filter((version) => version.documentId === row.id)
      .map((version) => ({
        ...version,
        usageCount: usageByVersion.get(version.id) ?? 0,
      })),
  }));
}

export function getDocument(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): DocumentRow | undefined {
  return database
    .select()
    .from(document)
    .where(
      and(eq(document.workspaceId, tenant.workspaceId), eq(document.id, id)),
    )
    .get();
}

export function getDocumentVersion(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): DocumentVersionRow | undefined {
  return database
    .select()
    .from(documentVersion)
    .where(
      and(
        eq(documentVersion.workspaceId, tenant.workspaceId),
        eq(documentVersion.id, id),
      ),
    )
    .get();
}

export function storeDocumentVersion(
  database: AppDatabase,
  tenant: TenantContext,
  input: StoreDocumentVersionInput,
  root = uploadsRoot(),
): DocumentVersionRow {
  const label = requiredText(input.label, "Version label");
  const extension = uploadExtensionFor(input.contentType ?? "");
  if (!extension) {
    throw new DocumentInputError(UPLOAD_TYPE_REFUSED);
  }
  if (input.bytes.byteLength === 0) {
    throw new DocumentInputError("That file is empty.");
  }
  if (input.bytes.byteLength > UPLOAD_MAX_BYTES) {
    throw new DocumentInputError(UPLOAD_TOO_LARGE);
  }

  const owner = getDocument(database, tenant, input.documentId);
  if (!owner) {
    throw new DocumentInputError("That document is not in this workspace.");
  }

  const id = input.id ?? randomUUID();
  const now = input.now ?? new Date();
  const storageKey = storageKeyFor(tenant.workspaceId, id, extension);

  const duplicate = database
    .select()
    .from(documentVersion)
    .where(
      and(
        eq(documentVersion.workspaceId, tenant.workspaceId),
        eq(documentVersion.documentId, owner.id),
        eq(documentVersion.label, label),
      ),
    )
    .get();
  if (duplicate) {
    throw new DocumentInputError(
      `${owner.name} already has a version called ${label}.`,
    );
  }

  // Write first, then record: a row whose file is missing would fail backup
  // verification, while an orphan file is inert and swept by the delete path.
  const stored = writeStoredFile(root, storageKey, input.bytes);

  try {
    return database.transaction((transaction) => {
      const row = transaction
        .insert(documentVersion)
        .values({
          id,
          workspaceId: tenant.workspaceId,
          documentId: owner.id,
          label,
          storageKey,
          sha256: stored.sha256,
          byteSize: stored.byteSize,
          contentType: input.contentType.trim().toLowerCase(),
          originalFilename: optionalText(input.originalFilename),
          createdAt: now,
        })
        .returning()
        .get();
      transaction
        .update(document)
        .set({ updatedAt: now })
        .where(
          and(
            eq(document.workspaceId, tenant.workspaceId),
            eq(document.id, owner.id),
          ),
        )
        .run();
      logEvent(transaction, tenant, {
        at: now,
        kind: "DOCUMENT_VERSION_ADDED",
        entityType: "document",
        entityId: owner.id,
        payload: { versionId: id, label, name: owner.name },
      });
      return row;
    });
  } catch (error) {
    deleteStoredFile(root, storageKey);
    throw error;
  }
}

export function countVersionUsage(
  database: AppDatabase,
  tenant: TenantContext,
  versionId: string,
): number {
  return database
    .select()
    .from(documentUsage)
    .where(
      and(
        eq(documentUsage.workspaceId, tenant.workspaceId),
        eq(documentUsage.versionId, versionId),
      ),
    )
    .all().length;
}

export function recordVersionUsage(
  database: AppDatabase,
  tenant: TenantContext,
  input: RecordVersionUsageInput,
) {
  const version = getDocumentVersion(database, tenant, input.versionId);
  if (!version) {
    throw new DocumentInputError("That document version is not in this workspace.");
  }
  const now = input.now ?? new Date();

  return database.transaction((transaction) => {
    const existing = transaction
      .select()
      .from(documentUsage)
      .where(
        and(
          eq(documentUsage.workspaceId, tenant.workspaceId),
          eq(documentUsage.versionId, input.versionId),
          eq(documentUsage.entityType, input.entityType),
          eq(documentUsage.entityId, input.entityId),
        ),
      )
      .get();
    if (existing) {
      return existing;
    }
    return transaction
      .insert(documentUsage)
      .values({
        id: randomUUID(),
        workspaceId: tenant.workspaceId,
        versionId: input.versionId,
        entityType: input.entityType,
        entityId: input.entityId,
        createdAt: now,
      })
      .returning()
      .get();
  });
}

export function clearVersionUsage(
  database: AppDatabase,
  tenant: TenantContext,
  input: { entityType: "application"; entityId: string },
): void {
  database
    .delete(documentUsage)
    .where(
      and(
        eq(documentUsage.workspaceId, tenant.workspaceId),
        eq(documentUsage.entityType, input.entityType),
        eq(documentUsage.entityId, input.entityId),
      ),
    )
    .run();
}

export function deleteDocumentVersion(
  database: AppDatabase,
  tenant: TenantContext,
  versionId: string,
  root = uploadsRoot(),
): void {
  const version = getDocumentVersion(database, tenant, versionId);
  if (!version) {
    throw new DocumentInputError("That document version is not in this workspace.");
  }
  if (countVersionUsage(database, tenant, versionId) > 0) {
    throw new DocumentInputError(DOCUMENT_VERSION_IN_USE);
  }

  database.transaction((transaction) => {
    transaction
      .delete(documentVersion)
      .where(
        and(
          eq(documentVersion.workspaceId, tenant.workspaceId),
          eq(documentVersion.id, versionId),
        ),
      )
      .run();
    logEvent(transaction, tenant, {
      at: new Date(),
      kind: "DOCUMENT_VERSION_DELETED",
      entityType: "document",
      entityId: version.documentId,
      payload: { versionId, label: version.label },
    });
  });

  deleteStoredFile(root, version.storageKey);
}

/**
 * The only path from an id to bytes. A version outside this workspace, or one
 * whose file has gone, is `undefined` — the caller turns that into a 404, never
 * into a different answer for a different workspace.
 */
export function readDocumentVersionFile(
  database: AppDatabase,
  tenant: TenantContext,
  versionId: string,
  root = uploadsRoot(),
): { version: DocumentVersionRow; bytes: Buffer } | undefined {
  const version = getDocumentVersion(database, tenant, versionId);
  if (!version || !storedFileExists(root, version.storageKey)) {
    return undefined;
  }
  return { version, bytes: readStoredFile(root, version.storageKey) };
}

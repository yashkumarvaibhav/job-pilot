import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

import {
  isTagEntityType,
  normalizeTagLabel,
  type TagEntityType,
} from "../../domain/tag";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import {
  company,
  contact,
  entityTag,
  opportunity,
  tag,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";

export type Tag = typeof tag.$inferSelect;
export type EntityTag = typeof entityTag.$inferSelect;
export type TaggedLabel = {
  tagId: string;
  label: string;
};

export type AttachTagInput = {
  id?: string;
  label: string;
  entityType: TagEntityType;
  entityId: string;
  now?: Date;
};

export class TagInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TagInputError";
  }
}

function requireLabel(value: string) {
  const normalized = normalizeTagLabel(value);
  if (!normalized) {
    throw new TagInputError("Tag label is required.");
  }
  return normalized;
}

function entityExists(
  transaction: AppTransaction,
  tenant: TenantContext,
  entityType: TagEntityType,
  entityId: string,
): boolean {
  if (entityType === "company") {
    return Boolean(
      transaction
        .select({ id: company.id })
        .from(company)
        .where(
          and(
            eq(company.workspaceId, tenant.workspaceId),
            eq(company.id, entityId),
          ),
        )
        .get(),
    );
  }
  if (entityType === "contact") {
    return Boolean(
      transaction
        .select({ id: contact.id })
        .from(contact)
        .where(
          and(
            eq(contact.workspaceId, tenant.workspaceId),
            eq(contact.id, entityId),
          ),
        )
        .get(),
    );
  }
  return Boolean(
    transaction
      .select({ id: opportunity.id })
      .from(opportunity)
      .where(
        and(
          eq(opportunity.workspaceId, tenant.workspaceId),
          eq(opportunity.id, entityId),
        ),
      )
      .get(),
  );
}

function selectTagByNormalized(
  transaction: AppTransaction,
  tenant: TenantContext,
  labelNormalized: string,
) {
  return transaction
    .select()
    .from(tag)
    .where(
      and(
        eq(tag.workspaceId, tenant.workspaceId),
        eq(tag.labelNormalized, labelNormalized),
      ),
    )
    .get();
}

function ensureTagRow(
  transaction: AppTransaction,
  tenant: TenantContext,
  label: string,
  now: Date,
  id?: string,
): Tag {
  const normalized = requireLabel(label);
  const existing = selectTagByNormalized(
    transaction,
    tenant,
    normalized.labelNormalized,
  );
  if (existing) {
    return existing;
  }

  return transaction
    .insert(tag)
    .values({
      id: id ?? randomUUID(),
      workspaceId: tenant.workspaceId,
      label: normalized.label,
      labelNormalized: normalized.labelNormalized,
      createdAt: now,
    })
    .returning()
    .get();
}

function selectLink(
  transaction: AppTransaction,
  tenant: TenantContext,
  tagId: string,
  entityType: TagEntityType,
  entityId: string,
) {
  return transaction
    .select()
    .from(entityTag)
    .where(
      and(
        eq(entityTag.workspaceId, tenant.workspaceId),
        eq(entityTag.tagId, tagId),
        eq(entityTag.entityType, entityType),
        eq(entityTag.entityId, entityId),
      ),
    )
    .get();
}

export function listEntityTags(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  entityType: TagEntityType,
  entityId: string,
): TaggedLabel[] {
  return database
    .select({ tagId: tag.id, label: tag.label })
    .from(entityTag)
    .innerJoin(
      tag,
      and(
        eq(tag.workspaceId, entityTag.workspaceId),
        eq(tag.id, entityTag.tagId),
      ),
    )
    .where(
      and(
        eq(entityTag.workspaceId, tenant.workspaceId),
        eq(entityTag.entityType, entityType),
        eq(entityTag.entityId, entityId),
      ),
    )
    .orderBy(asc(entityTag.createdAt), asc(tag.id))
    .all();
}

function currentCachedLabels(
  transaction: AppTransaction,
  tenant: TenantContext,
  entityType: TagEntityType,
  entityId: string,
): string[] {
  if (entityType === "contact") {
    return (
      transaction
        .select({ tagsJson: contact.tagsJson })
        .from(contact)
        .where(
          and(
            eq(contact.workspaceId, tenant.workspaceId),
            eq(contact.id, entityId),
          ),
        )
        .get()?.tagsJson ?? []
    );
  }
  if (entityType === "opportunity") {
    return (
      transaction
        .select({ tagsJson: opportunity.tagsJson })
        .from(opportunity)
        .where(
          and(
            eq(opportunity.workspaceId, tenant.workspaceId),
            eq(opportunity.id, entityId),
          ),
        )
        .get()?.tagsJson ?? []
    );
  }
  return [];
}

function writeCachedLabels(
  transaction: AppTransaction,
  tenant: TenantContext,
  entityType: TagEntityType,
  entityId: string,
  labels: string[],
) {
  if (entityType === "contact") {
    transaction
      .update(contact)
      .set({ tagsJson: labels })
      .where(
        and(
          eq(contact.workspaceId, tenant.workspaceId),
          eq(contact.id, entityId),
        ),
      )
      .run();
  }
  if (entityType === "opportunity") {
    transaction
      .update(opportunity)
      .set({ tagsJson: labels })
      .where(
        and(
          eq(opportunity.workspaceId, tenant.workspaceId),
          eq(opportunity.id, entityId),
        ),
      )
      .run();
  }
}

export function attachTagInTransaction(
  transaction: AppTransaction,
  tenant: TenantContext,
  input: AttachTagInput,
): TaggedLabel | undefined {
  if (!isTagEntityType(input.entityType)) {
    throw new TagInputError("Choose a company, contact, or opportunity.");
  }
  if (!entityExists(transaction, tenant, input.entityType, input.entityId)) {
    return undefined;
  }

  const now = input.now ?? new Date();
  const tagRow = ensureTagRow(
    transaction,
    tenant,
    input.label,
    now,
    input.id,
  );
  const existing = selectLink(
    transaction,
    tenant,
    tagRow.id,
    input.entityType,
    input.entityId,
  );
  if (existing) {
    return { tagId: tagRow.id, label: tagRow.label };
  }

  transaction
    .insert(entityTag)
    .values({
      id: randomUUID(),
      workspaceId: tenant.workspaceId,
      tagId: tagRow.id,
      entityType: input.entityType,
      entityId: input.entityId,
      createdAt: now,
    })
    .run();
  const cached = currentCachedLabels(
    transaction,
    tenant,
    input.entityType,
    input.entityId,
  );
  if (
    !cached.some(
      (label) =>
        normalizeTagLabel(label)?.labelNormalized === tagRow.labelNormalized,
    )
  ) {
    writeCachedLabels(transaction, tenant, input.entityType, input.entityId, [
      ...cached,
      tagRow.label,
    ]);
  }
  logEvent(transaction, tenant, {
    at: now,
    kind: "TAG_ATTACHED",
    entityType: input.entityType,
    entityId: input.entityId,
    payload: { tagId: tagRow.id, label: tagRow.label },
  });
  return { tagId: tagRow.id, label: tagRow.label };
}

export function attachTag(
  database: AppDatabase,
  tenant: TenantContext,
  input: AttachTagInput,
): TaggedLabel | undefined {
  return database.transaction((transaction) =>
    attachTagInTransaction(transaction, tenant, input),
  );
}

export function replaceEntityTagsInTransaction(
  transaction: AppTransaction,
  tenant: TenantContext,
  entityType: TagEntityType,
  entityId: string,
  labels: string[],
  now = new Date(),
): TaggedLabel[] {
  if (!entityExists(transaction, tenant, entityType, entityId)) {
    return [];
  }

  const desired = new Map<string, string>();
  for (const label of labels) {
    const normalized = normalizeTagLabel(label);
    if (!normalized) {
      continue;
    }
    if (!desired.has(normalized.labelNormalized)) {
      desired.set(normalized.labelNormalized, normalized.label);
    }
  }

  const current = listEntityTags(transaction, tenant, entityType, entityId);
  for (const item of current) {
    const key = normalizeTagLabel(item.label)?.labelNormalized;
    if (!key || !desired.has(key)) {
      detachTagInTransaction(transaction, tenant, {
        tagId: item.tagId,
        entityType,
        entityId,
        now,
      });
    }
  }

  const attached: TaggedLabel[] = [];
  for (const label of desired.values()) {
    const row = attachTagInTransaction(transaction, tenant, {
      label,
      entityType,
      entityId,
      now,
    });
    if (row) {
      attached.push(row);
    }
  }
  writeCachedLabels(
    transaction,
    tenant,
    entityType,
    entityId,
    attached.map((item) => item.label),
  );
  return attached;
}

export function listTags(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
): Tag[] {
  return database
    .select()
    .from(tag)
    .where(eq(tag.workspaceId, tenant.workspaceId))
    .orderBy(asc(tag.label), asc(tag.id))
    .all();
}

export function getTag(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  id: string,
): Tag | undefined {
  return database
    .select()
    .from(tag)
    .where(and(eq(tag.workspaceId, tenant.workspaceId), eq(tag.id, id)))
    .get();
}

export function detachTagInTransaction(
  transaction: AppTransaction,
  tenant: TenantContext,
  input: {
    tagId: string;
    entityType: TagEntityType;
    entityId: string;
    now?: Date;
  },
): boolean {
  if (!isTagEntityType(input.entityType)) {
    return false;
  }
  const current = selectLink(
    transaction,
    tenant,
    input.tagId,
    input.entityType,
    input.entityId,
  );
  if (!current) {
    return false;
  }
  const tagRow = getTag(transaction, tenant, input.tagId);
  transaction
    .delete(entityTag)
    .where(
      and(
        eq(entityTag.workspaceId, tenant.workspaceId),
        eq(entityTag.id, current.id),
      ),
    )
    .run();
  writeCachedLabels(
    transaction,
    tenant,
    input.entityType,
    input.entityId,
    currentCachedLabels(
      transaction,
      tenant,
      input.entityType,
      input.entityId,
    ).filter(
      (label) =>
        normalizeTagLabel(label)?.labelNormalized !==
        (tagRow ? tagRow.labelNormalized : ""),
    ),
  );
  logEvent(transaction, tenant, {
    at: input.now ?? new Date(),
    kind: "TAG_DETACHED",
    entityType: input.entityType,
    entityId: input.entityId,
    payload: { tagId: input.tagId, label: tagRow?.label ?? null },
  });
  return true;
}

export function detachTag(
  database: AppDatabase,
  tenant: TenantContext,
  input: {
    tagId: string;
    entityType: TagEntityType;
    entityId: string;
    now?: Date;
  },
): boolean {
  return database.transaction((transaction) =>
    detachTagInTransaction(transaction, tenant, input),
  );
}

export function deleteTag(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  at = new Date(),
): boolean {
  return database.transaction((transaction) => {
    const current = getTag(transaction, tenant, id);
    if (!current) {
      return false;
    }

    const links = transaction
      .select({
        entityType: entityTag.entityType,
        entityId: entityTag.entityId,
      })
      .from(entityTag)
      .where(
        and(
          eq(entityTag.workspaceId, tenant.workspaceId),
          eq(entityTag.tagId, id),
        ),
      )
      .all();

    transaction
      .delete(tag)
      .where(and(eq(tag.workspaceId, tenant.workspaceId), eq(tag.id, id)))
      .run();

    for (const link of links) {
      if (isTagEntityType(link.entityType)) {
        writeCachedLabels(
          transaction,
          tenant,
          link.entityType,
          link.entityId,
          currentCachedLabels(
            transaction,
            tenant,
            link.entityType,
            link.entityId,
          ).filter(
            (label) =>
              normalizeTagLabel(label)?.labelNormalized !==
              current.labelNormalized,
          ),
        );
      }
    }

    logEvent(transaction, tenant, {
      at,
      kind: "TAG_DELETED",
      entityType: "tag",
      entityId: id,
      payload: { label: current.label },
    });
    return true;
  });
}

export function clearEntityTagsInTransaction(
  transaction: AppTransaction,
  tenant: TenantContext,
  entityType: TagEntityType,
  entityId: string,
) {
  transaction
    .delete(entityTag)
    .where(
      and(
        eq(entityTag.workspaceId, tenant.workspaceId),
        eq(entityTag.entityType, entityType),
        eq(entityTag.entityId, entityId),
      ),
    )
    .run();
}

export function labelsForEntities(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  entityType: TagEntityType,
  entityIds: string[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  if (entityIds.length === 0) {
    return grouped;
  }
  const rows = database
    .select({
      entityId: entityTag.entityId,
      label: tag.label,
    })
    .from(entityTag)
    .innerJoin(
      tag,
      and(
        eq(tag.workspaceId, entityTag.workspaceId),
        eq(tag.id, entityTag.tagId),
      ),
    )
    .where(
      and(
        eq(entityTag.workspaceId, tenant.workspaceId),
        eq(entityTag.entityType, entityType),
        inArray(entityTag.entityId, entityIds),
      ),
    )
    .orderBy(asc(tag.label), asc(tag.id))
    .all();
  for (const row of rows) {
    const current = grouped.get(row.entityId) ?? [];
    current.push(row.label);
    grouped.set(row.entityId, current);
  }
  return grouped;
}

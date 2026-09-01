import { and, eq } from "drizzle-orm";

import type { ImportEntitySet } from "../imports/import-service";
import type { AppDatabase } from "../db/client";
import { importMapping } from "../db/schema";
import type { TenantContext } from "../db/tenant";

export function getImportMapping(
  database: AppDatabase,
  tenant: TenantContext,
  entitySet: ImportEntitySet,
): Record<string, string> {
  return (
    database
      .select({ mapping: importMapping.mappingJson })
      .from(importMapping)
      .where(
        and(
          eq(importMapping.workspaceId, tenant.workspaceId),
          eq(importMapping.entitySet, entitySet),
        ),
      )
      .get()?.mapping ?? {}
  );
}

export function saveImportMapping(
  database: AppDatabase,
  tenant: TenantContext,
  entitySet: ImportEntitySet,
  mapping: Record<string, string>,
  at = new Date(),
): Record<string, string> {
  database
    .insert(importMapping)
    .values({
      workspaceId: tenant.workspaceId,
      entitySet,
      mappingJson: mapping,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: [importMapping.workspaceId, importMapping.entitySet],
      set: { mappingJson: mapping, updatedAt: at },
    })
    .run();
  return mapping;
}

import { randomUUID } from "node:crypto";

import type { AppTransaction } from "./client";
import { activityEvent } from "./schema";
import type { TenantContext } from "./tenant";

export type LogEventInput = {
  id?: string;
  at?: Date;
  kind: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
};

export function logEvent(
  transaction: AppTransaction,
  tenant: TenantContext,
  input: LogEventInput,
) {
  return transaction
    .insert(activityEvent)
    .values({
      id: input.id ?? randomUUID(),
      workspaceId: tenant.workspaceId,
      at: input.at ?? new Date(),
      kind: input.kind,
      entityType: input.entityType,
      entityId: input.entityId,
      payloadJson: input.payload ?? {},
    })
    .returning()
    .get();
}

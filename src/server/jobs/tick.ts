import { eq } from "drizzle-orm";

import type { AppDatabase } from "../db/client";
import { workspace } from "../db/schema";
import { createTenantContext } from "../db/tenant";
import { syncInboxAccount, type InboxSyncDependencies } from "../mail/inbox-sync";
import { listAccountsWithDueApprovedSequence } from "../repos/sequences";
import { processDueDigests } from "../repos/digest";
import {
  flushSendQueue,
  type SendQueueDependencies,
} from "./send-queue";

export type TickDependencies = SendQueueDependencies & {
  read?: InboxSyncDependencies | null;
};

export async function runTick(
  database: AppDatabase,
  dependencies: TickDependencies,
  options: {
    now?: Date;
    reclaimAfterMs?: number;
    maxSends?: number;
    onlyQueueId?: string;
  } = {},
) {
  const now = options.now ?? new Date();
  if (dependencies.read) {
    for (const row of listAccountsWithDueApprovedSequence(database, now)) {
      const owner = database
        .select({ userId: workspace.ownerUserId })
        .from(workspace)
        .where(eq(workspace.id, row.workspaceId))
        .get();
      if (!owner) continue;
      const tenant = createTenantContext(owner.userId, row.workspaceId);
      try {
        await syncInboxAccount(database, tenant, row.accountId, {
          ...dependencies.read,
          now: () => now,
        });
      } catch {
        // Claim holds the row when the mailbox is still unproven.
      }
    }
  }
  processDueDigests(database, now);
  return flushSendQueue(database, dependencies, { ...options, now });
}

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { logEvent } from "./activity";
import type { AppDatabase, AppTransaction } from "./client";
import { activityEvent, settings, userAccount, workspace } from "./schema";
import { createTenantContext, type TenantContext } from "./tenant";
import { assertIanaTimeZone, DEFAULT_TIME_ZONE } from "./timezone";

type FoundationIds = {
  userId: string;
  workspaceId: string;
};

export type CreateAccountFoundationInput = {
  emailNormalized: string;
  passwordHash: string;
  displayName?: string;
  university?: string;
  timezone?: string;
  now?: Date;
  ids?: FoundationIds;
};

export function createAccountFoundation(
  database: AppDatabase,
  input: CreateAccountFoundationInput,
): { tenant: TenantContext } {
  const timezone = assertIanaTimeZone(input.timezone ?? DEFAULT_TIME_ZONE);
  const now = input.now ?? new Date();
  const ids = input.ids ?? {
    userId: randomUUID(),
    workspaceId: randomUUID(),
  };
  const tenant = createTenantContext(ids.userId, ids.workspaceId);

  return database.transaction((transaction) => {
    transaction
      .insert(userAccount)
      .values({
        id: tenant.userId,
        emailNormalized: input.emailNormalized,
        passwordHash: input.passwordHash,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    transaction
      .insert(workspace)
      .values({
        id: tenant.workspaceId,
        ownerUserId: tenant.userId,
        createdAt: now,
      })
      .run();
    transaction
      .insert(settings)
      .values({
        workspaceId: tenant.workspaceId,
        displayName: input.displayName ?? "",
        university: input.university,
        timezone,
      })
      .run();
    logEvent(transaction, tenant, {
      at: now,
      kind: "ACCOUNT_FOUNDATION_CREATED",
      entityType: "workspace",
      entityId: tenant.workspaceId,
    });

    return { tenant };
  });
}

export function getWorkspaceSettings(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  candidateWorkspaceId: string,
) {
  return database
    .select()
    .from(settings)
    .where(
      and(
        eq(settings.workspaceId, tenant.workspaceId),
        eq(settings.workspaceId, candidateWorkspaceId),
      ),
    )
    .get();
}

export function getActivityEvent(
  database: AppDatabase,
  tenant: TenantContext,
  eventId: string,
) {
  return database
    .select()
    .from(activityEvent)
    .where(
      and(
        eq(activityEvent.workspaceId, tenant.workspaceId),
        eq(activityEvent.id, eventId),
      ),
    )
    .get();
}

export function updateWorkspaceTimezone(
  database: AppDatabase,
  tenant: TenantContext,
  candidateWorkspaceId: string,
  timeZone: string,
  at = new Date(),
): boolean {
  const timezone = assertIanaTimeZone(timeZone);

  return database.transaction((transaction) => {
    const current = transaction
      .select({ timezone: settings.timezone })
      .from(settings)
      .where(
        and(
          eq(settings.workspaceId, tenant.workspaceId),
          eq(settings.workspaceId, candidateWorkspaceId),
        ),
      )
      .get();

    if (!current) {
      return false;
    }

    transaction
      .update(settings)
      .set({ timezone })
      .where(eq(settings.workspaceId, tenant.workspaceId))
      .run();
    logEvent(transaction, tenant, {
      at,
      kind: "SETTINGS_TIMEZONE_CHANGED",
      entityType: "workspace",
      entityId: tenant.workspaceId,
      payload: { from: current.timezone, to: timezone },
    });

    return true;
  });
}

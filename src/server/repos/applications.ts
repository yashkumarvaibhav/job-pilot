import { randomUUID } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";

import {
  DEFAULT_APPLICATION_STAGE,
  isApplicationStage,
  type ApplicationStage,
} from "../../domain/application";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import {
  application,
  company,
  documentUsage,
  documentVersion,
  opportunity,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";

export type Application = typeof application.$inferSelect;
export type ApplicationListItem = Application & {
  companyName: string;
  role: string;
};

export type ApplyToOpportunityInput = {
  id?: string;
  opportunityId: string;
  portal: string;
  appliedOn: string;
  applicationExternalId?: string | null;
  referrer?: string | null;
  resumeVersionId?: string | null;
  notes?: string | null;
  now?: Date;
};

export type UpdateApplicationInput = Partial<
  Pick<
    ApplyToOpportunityInput,
    | "portal"
    | "appliedOn"
    | "applicationExternalId"
    | "referrer"
    | "resumeVersionId"
    | "notes"
  > & { stage: ApplicationStage }
>;

export class ApplicationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationInputError";
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ApplicationInputError(`${label} is required.`);
  }
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requiredDate(value: string, label: string): string {
  const normalized = requiredText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new ApplicationInputError(`${label} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new ApplicationInputError(`${label} must be a real calendar date.`);
  }
  return normalized;
}

function validStage(value: unknown): ApplicationStage {
  if (!isApplicationStage(value)) {
    throw new ApplicationInputError("Choose a valid application stage.");
  }
  return value;
}

function selectApplication(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  id: string,
): ApplicationListItem | undefined {
  const found = database
    .select({
      application,
      companyName: company.name,
      role: opportunity.role,
    })
    .from(application)
    .innerJoin(
      opportunity,
      and(
        eq(opportunity.workspaceId, application.workspaceId),
        eq(opportunity.id, application.opportunityId),
      ),
    )
    .innerJoin(
      company,
      and(
        eq(company.workspaceId, opportunity.workspaceId),
        eq(company.id, opportunity.companyId),
      ),
    )
    .where(
      and(
        eq(application.workspaceId, tenant.workspaceId),
        eq(application.id, id),
      ),
    )
    .get();

  return found
    ? { ...found.application, companyName: found.companyName, role: found.role }
    : undefined;
}

function selectApplicationForOpportunity(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  opportunityId: string,
): ApplicationListItem | undefined {
  const found = database
    .select({
      application,
      companyName: company.name,
      role: opportunity.role,
    })
    .from(application)
    .innerJoin(
      opportunity,
      and(
        eq(opportunity.workspaceId, application.workspaceId),
        eq(opportunity.id, application.opportunityId),
      ),
    )
    .innerJoin(
      company,
      and(
        eq(company.workspaceId, opportunity.workspaceId),
        eq(company.id, opportunity.companyId),
      ),
    )
    .where(
      and(
        eq(application.workspaceId, tenant.workspaceId),
        eq(application.opportunityId, opportunityId),
      ),
    )
    .get();

  return found
    ? { ...found.application, companyName: found.companyName, role: found.role }
    : undefined;
}

function ownedOpportunity(
  transaction: AppTransaction,
  tenant: TenantContext,
  opportunityId: string,
) {
  return transaction
    .select({ id: opportunity.id })
    .from(opportunity)
    .where(
      and(
        eq(opportunity.workspaceId, tenant.workspaceId),
        eq(opportunity.id, opportunityId),
      ),
    )
    .get();
}

/**
 * `application.resume_version_id` and the matching `document_usage` row are one
 * fact, written together: §39 says an application records exactly which version
 * it used, and a delete is refused on the strength of that usage row. If the two
 * could drift, a version still in use would become deletable.
 */
function syncResumeVersionUsage(
  transaction: AppTransaction,
  tenant: TenantContext,
  applicationId: string,
  versionId: string | null,
  at: Date,
): void {
  transaction
    .delete(documentUsage)
    .where(
      and(
        eq(documentUsage.workspaceId, tenant.workspaceId),
        eq(documentUsage.entityType, "application"),
        eq(documentUsage.entityId, applicationId),
      ),
    )
    .run();

  if (versionId === null) {
    return;
  }

  const owned = transaction
    .select()
    .from(documentVersion)
    .where(
      and(
        eq(documentVersion.workspaceId, tenant.workspaceId),
        eq(documentVersion.id, versionId),
      ),
    )
    .get();
  if (!owned) {
    throw new ApplicationInputError(
      "That resume version is not in this workspace.",
    );
  }

  transaction
    .insert(documentUsage)
    .values({
      id: randomUUID(),
      workspaceId: tenant.workspaceId,
      versionId,
      entityType: "application",
      entityId: applicationId,
      createdAt: at,
    })
    .run();
}

export function applyToOpportunity(
  database: AppDatabase,
  tenant: TenantContext,
  input: ApplyToOpportunityInput,
): ApplicationListItem | undefined {
  return database.transaction((transaction) => {
    if (!ownedOpportunity(transaction, tenant, input.opportunityId)) {
      return undefined;
    }

    const existing = selectApplicationForOpportunity(
      transaction,
      tenant,
      input.opportunityId,
    );
    if (existing) {
      return existing;
    }

    const id = input.id ?? randomUUID();
    const now = input.now ?? new Date();
    transaction
      .insert(application)
      .values({
        id,
        workspaceId: tenant.workspaceId,
        opportunityId: input.opportunityId,
        portal: requiredText(input.portal, "Portal"),
        appliedOn: requiredDate(input.appliedOn, "Applied date"),
        applicationExternalId: optionalText(input.applicationExternalId),
        referrer: optionalText(input.referrer),
        resumeVersionId: optionalText(input.resumeVersionId),
        stage: DEFAULT_APPLICATION_STAGE,
        notes: optionalText(input.notes),
        createdAt: now,
      })
      .run();
    syncResumeVersionUsage(
      transaction,
      tenant,
      id,
      optionalText(input.resumeVersionId),
      now,
    );
    transaction
      .update(opportunity)
      .set({ stage: "applied" })
      .where(
        and(
          eq(opportunity.workspaceId, tenant.workspaceId),
          eq(opportunity.id, input.opportunityId),
        ),
      )
      .run();
    logEvent(transaction, tenant, {
      at: now,
      kind: "APPLICATION_SUBMITTED",
      entityType: "application",
      entityId: id,
      payload: { opportunityId: input.opportunityId },
    });

    return selectApplication(transaction, tenant, id)!;
  });
}

export function listApplications(
  database: AppDatabase,
  tenant: TenantContext,
): ApplicationListItem[] {
  return database
    .select({
      application,
      companyName: company.name,
      role: opportunity.role,
    })
    .from(application)
    .innerJoin(
      opportunity,
      and(
        eq(opportunity.workspaceId, application.workspaceId),
        eq(opportunity.id, application.opportunityId),
      ),
    )
    .innerJoin(
      company,
      and(
        eq(company.workspaceId, opportunity.workspaceId),
        eq(company.id, opportunity.companyId),
      ),
    )
    .where(eq(application.workspaceId, tenant.workspaceId))
    .orderBy(
      desc(application.appliedOn),
      asc(company.name),
      asc(opportunity.role),
      asc(application.id),
    )
    .all()
    .map(({ application: row, companyName, role }) => ({
      ...row,
      companyName,
      role,
    }));
}

export function getApplication(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): ApplicationListItem | undefined {
  return selectApplication(database, tenant, id);
}

export function getApplicationForOpportunity(
  database: AppDatabase,
  tenant: TenantContext,
  opportunityId: string,
): ApplicationListItem | undefined {
  return selectApplicationForOpportunity(database, tenant, opportunityId);
}

function updateValues(input: UpdateApplicationInput) {
  const values: Partial<typeof application.$inferInsert> = {};

  if (input.portal !== undefined)
    values.portal = requiredText(input.portal, "Portal");
  if (input.appliedOn !== undefined)
    values.appliedOn = requiredDate(input.appliedOn, "Applied date");
  if (input.applicationExternalId !== undefined)
    values.applicationExternalId = optionalText(input.applicationExternalId);
  if (input.referrer !== undefined)
    values.referrer = optionalText(input.referrer);
  if (input.resumeVersionId !== undefined)
    values.resumeVersionId = optionalText(input.resumeVersionId);
  if (input.notes !== undefined) values.notes = optionalText(input.notes);
  if (input.stage !== undefined) values.stage = validStage(input.stage);

  return values;
}

export function updateApplication(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  input: UpdateApplicationInput,
  at = new Date(),
): ApplicationListItem | undefined {
  const values = updateValues(input);

  return database.transaction((transaction) => {
    const current = selectApplication(transaction, tenant, id);
    if (!current) {
      return undefined;
    }
    if (Object.keys(values).length === 0) {
      return current;
    }

    transaction
      .update(application)
      .set(values)
      .where(
        and(
          eq(application.workspaceId, tenant.workspaceId),
          eq(application.id, id),
        ),
      )
      .run();
    if (input.resumeVersionId !== undefined) {
      syncResumeVersionUsage(
        transaction,
        tenant,
        id,
        values.resumeVersionId ?? null,
        at,
      );
    }
    logEvent(transaction, tenant, {
      at,
      kind: "APPLICATION_UPDATED",
      entityType: "application",
      entityId: id,
      payload: { fields: Object.keys(values).sort() },
    });

    return selectApplication(transaction, tenant, id)!;
  });
}

import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";

import {
  isInteractionChannel,
  isInteractionDirection,
  type InteractionChannel,
  type InteractionDirection,
} from "../../domain/interaction";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import { company, contact, interaction, opportunity } from "../db/schema";
import type { TenantContext } from "../db/tenant";

export type Interaction = typeof interaction.$inferSelect;

export type CreateInteractionInput = {
  id?: string;
  contactId?: string | null;
  companyId?: string | null;
  opportunityId?: string | null;
  referralId?: string | null;
  channel: InteractionChannel;
  direction: InteractionDirection;
  body?: string;
  requiresReply?: boolean;
  occurredAt?: Date;
  now?: Date;
};

export type InteractionListFilter = {
  contactId?: string;
  companyId?: string;
  opportunityId?: string;
  referralId?: string;
};

export class InteractionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InteractionInputError";
  }
}

function optionalId(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requiredChannel(value: unknown): InteractionChannel {
  if (!isInteractionChannel(value)) {
    throw new InteractionInputError("Choose a valid channel.");
  }
  return value;
}

function requiredDirection(value: unknown): InteractionDirection {
  if (!isInteractionDirection(value)) {
    throw new InteractionInputError("Choose inbound or outbound.");
  }
  return value;
}

function validInstant(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new InteractionInputError(`${label} must be a valid instant.`);
  }
  return value;
}

function activityKind(direction: InteractionDirection): string {
  return direction === "outbound" ? "INTERACTION_SENT" : "INTERACTION_REPLIED";
}

function requireOwnedContact(
  transaction: AppTransaction,
  tenant: TenantContext,
  contactId: string | null,
) {
  if (contactId === null) {
    return null;
  }
  const found = transaction
    .select()
    .from(contact)
    .where(
      and(
        eq(contact.workspaceId, tenant.workspaceId),
        eq(contact.id, contactId),
      ),
    )
    .get();
  if (!found) {
    throw new InteractionInputError("Contact not found.");
  }
  return found;
}

function requireOwnedCompany(
  transaction: AppTransaction,
  tenant: TenantContext,
  companyId: string | null,
): void {
  if (companyId === null) {
    return;
  }
  const found = transaction
    .select({ id: company.id })
    .from(company)
    .where(
      and(
        eq(company.workspaceId, tenant.workspaceId),
        eq(company.id, companyId),
      ),
    )
    .get();
  if (!found) {
    throw new InteractionInputError("Company not found.");
  }
}

function requireOwnedOpportunity(
  transaction: AppTransaction,
  tenant: TenantContext,
  opportunityId: string | null,
): void {
  if (opportunityId === null) {
    return;
  }
  const found = transaction
    .select({ id: opportunity.id })
    .from(opportunity)
    .where(
      and(
        eq(opportunity.workspaceId, tenant.workspaceId),
        eq(opportunity.id, opportunityId),
      ),
    )
    .get();
  if (!found) {
    throw new InteractionInputError("Opportunity not found.");
  }
}

function resolveOpenNeedReply(
  transaction: AppTransaction,
  tenant: TenantContext,
  contactId: string,
  at: Date,
): void {
  transaction
    .update(interaction)
    .set({ replyResolvedAt: at })
    .where(
      and(
        eq(interaction.workspaceId, tenant.workspaceId),
        eq(interaction.contactId, contactId),
        eq(interaction.requiresReply, true),
        isNull(interaction.replyResolvedAt),
      ),
    )
    .run();
}

function touchContactLastInteraction(
  transaction: AppTransaction,
  tenant: TenantContext,
  contactId: string,
  occurredAt: Date,
): void {
  const current = transaction
    .select({ lastInteractionAt: contact.lastInteractionAt })
    .from(contact)
    .where(
      and(
        eq(contact.workspaceId, tenant.workspaceId),
        eq(contact.id, contactId),
      ),
    )
    .get();
  if (
    current &&
    (current.lastInteractionAt === null ||
      occurredAt.valueOf() >= current.lastInteractionAt.valueOf())
  ) {
    transaction
      .update(contact)
      .set({ lastInteractionAt: occurredAt })
      .where(
        and(
          eq(contact.workspaceId, tenant.workspaceId),
          eq(contact.id, contactId),
        ),
      )
      .run();
  }
}

export function createInteraction(
  database: AppDatabase,
  tenant: TenantContext,
  input: CreateInteractionInput,
): Interaction {
  const id = input.id ?? randomUUID();
  const now = input.now ?? new Date();
  const occurredAt = validInstant(input.occurredAt ?? now, "Occurred at");
  const channel = requiredChannel(input.channel);
  const direction = requiredDirection(input.direction);
  const requiresReply = input.requiresReply === true;
  if (requiresReply && direction !== "inbound") {
    throw new InteractionInputError(
      "Needs my reply only applies to inbound interactions.",
    );
  }

  const created = database.transaction((transaction) => {
    const contactId = optionalId(input.contactId);
    const ownedContact = requireOwnedContact(transaction, tenant, contactId);
    const companyId =
      optionalId(input.companyId) ?? ownedContact?.companyId ?? null;
    const opportunityId = optionalId(input.opportunityId);
    const referralId = optionalId(input.referralId);
    if (
      contactId === null &&
      companyId === null &&
      opportunityId === null &&
      referralId === null
    ) {
      throw new InteractionInputError(
        "Link this interaction to a contact, company, opportunity, or referral.",
      );
    }
    requireOwnedCompany(transaction, tenant, companyId);
    requireOwnedOpportunity(transaction, tenant, opportunityId);

    const row = transaction
      .insert(interaction)
      .values({
        id,
        workspaceId: tenant.workspaceId,
        contactId,
        companyId,
        opportunityId,
        referralId,
        channel,
        direction,
        occurredAt,
        body: (input.body ?? "").trim(),
        requiresReply,
        replyResolvedAt: null,
        createdAt: now,
      })
      .returning()
      .get();

    if (direction === "outbound" && contactId !== null) {
      resolveOpenNeedReply(transaction, tenant, contactId, now);
    }
    if (contactId !== null) {
      touchContactLastInteraction(transaction, tenant, contactId, occurredAt);
    }

    logEvent(transaction, tenant, {
      at: now,
      kind: activityKind(direction),
      entityType: "interaction",
      entityId: id,
      payload: {
        channel,
        direction,
        contactId,
        companyId,
        opportunityId,
        referralId,
      },
    });
    return row;
  });

  return created;
}

export function listInteractions(
  database: AppDatabase,
  tenant: TenantContext,
  filter: InteractionListFilter = {},
): Interaction[] {
  const conditions = [eq(interaction.workspaceId, tenant.workspaceId)];
  if (filter.contactId !== undefined) {
    conditions.push(eq(interaction.contactId, filter.contactId));
  }
  if (filter.companyId !== undefined) {
    conditions.push(eq(interaction.companyId, filter.companyId));
  }
  if (filter.opportunityId !== undefined) {
    conditions.push(eq(interaction.opportunityId, filter.opportunityId));
  }
  if (filter.referralId !== undefined) {
    conditions.push(eq(interaction.referralId, filter.referralId));
  }

  return database
    .select()
    .from(interaction)
    .where(and(...conditions))
    .orderBy(desc(interaction.occurredAt), desc(interaction.id))
    .all();
}

export function getInteraction(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): Interaction | undefined {
  return database
    .select()
    .from(interaction)
    .where(
      and(
        eq(interaction.workspaceId, tenant.workspaceId),
        eq(interaction.id, id),
      ),
    )
    .get();
}

export function countUnresolvedNeedReply(
  database: AppDatabase,
  tenant: TenantContext,
): number {
  const rows = database
    .select({ id: interaction.id })
    .from(interaction)
    .where(
      and(
        eq(interaction.workspaceId, tenant.workspaceId),
        eq(interaction.requiresReply, true),
        isNull(interaction.replyResolvedAt),
      ),
    )
    .all();
  return rows.length;
}

export function markInteractionReplied(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  at = new Date(),
): Interaction | undefined {
  const updated = database.transaction((transaction) => {
    const current = transaction
      .select()
      .from(interaction)
      .where(
        and(
          eq(interaction.workspaceId, tenant.workspaceId),
          eq(interaction.id, id),
        ),
      )
      .get();
    if (!current) {
      return undefined;
    }
    if (!current.requiresReply) {
      throw new InteractionInputError(
        "This interaction is not waiting for a reply.",
      );
    }
    if (current.replyResolvedAt !== null) {
      return current;
    }

    const row = transaction
      .update(interaction)
      .set({ replyResolvedAt: at })
      .where(
        and(
          eq(interaction.workspaceId, tenant.workspaceId),
          eq(interaction.id, id),
        ),
      )
      .returning()
      .get();
    logEvent(transaction, tenant, {
      at,
      kind: "INTERACTION_LOGGED",
      entityType: "interaction",
      entityId: id,
      payload: { action: "mark_replied" },
    });
    return row;
  });

  return updated;
}

import { and, asc, eq, ne } from "drizzle-orm";

import {
  DEFAULT_CONTACT_COOLDOWN_DAYS,
  DEFAULT_MAX_OUTREACH_PER_OPPORTUNITY,
} from "../../domain/bounce";
import type { InteractionChannel } from "../../domain/interaction";
import {
  formatCooldownWarning,
  formatDuplicateOutreachWarning,
  isWithinCooldown,
  outreachDaysAgo,
  shouldWarnDuplicateOutreach,
  type OutreachChannelCount,
  type OutreachWarning,
} from "../../domain/outreach-warning";
import { logEvent } from "../db/activity";
import type { AppDatabase } from "../db/client";
import {
  contact,
  interaction,
  opportunity,
  settings,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { getContact } from "./contacts";
import { getOpportunity } from "./opportunities";
import { getSuppressionBlock } from "./send-safety";

export type ComposeOutreachDecision =
  | { kind: "blocked"; message: string }
  | { kind: "warning"; warnings: OutreachWarning[]; copy: string }
  | { kind: "ok" };

function primaryEmail(
  methods: NonNullable<ReturnType<typeof getContact>>["methods"],
): string | null {
  const emails = methods.filter((method) => method.kind === "email");
  return (emails.find((method) => method.isPrimary) ?? emails[0])?.valueNormalized ?? null;
}

function outreachSettings(database: AppDatabase, tenant: TenantContext) {
  const row = database
    .select({
      contactCooldownDays: settings.contactCooldownDays,
      maxOutreachPerOpportunity: settings.maxOutreachPerOpportunity,
    })
    .from(settings)
    .where(eq(settings.workspaceId, tenant.workspaceId))
    .get();
  return {
    cooldownDays: row?.contactCooldownDays ?? DEFAULT_CONTACT_COOLDOWN_DAYS,
    maxOutreach:
      row?.maxOutreachPerOpportunity ?? DEFAULT_MAX_OUTREACH_PER_OPPORTUNITY,
  };
}

function channelCountsForContact(
  database: AppDatabase,
  tenant: TenantContext,
  contactId: string,
): OutreachChannelCount[] {
  const rows = database
    .select({ channel: interaction.channel })
    .from(interaction)
    .where(
      and(
        eq(interaction.workspaceId, tenant.workspaceId),
        eq(interaction.contactId, contactId),
        eq(interaction.direction, "outbound"),
      ),
    )
    .all();
  const counts = new Map<InteractionChannel, number>();
  for (const row of rows) {
    counts.set(row.channel, (counts.get(row.channel) ?? 0) + 1);
  }
  return [...counts.entries()].map(([channel, count]) => ({ channel, count }));
}

export function evaluateComposeOutreach(
  database: AppDatabase,
  tenant: TenantContext,
  input: {
    contactId: string;
    opportunityId?: string | null;
    now?: Date;
  },
): ComposeOutreachDecision {
  const now = input.now ?? new Date();
  const detail = getContact(database, tenant, input.contactId);
  if (!detail) return { kind: "ok" };
  const email = primaryEmail(detail.methods);
  if (email) {
    const blocked = getSuppressionBlock(database, tenant, email, detail.id);
    if (blocked) return { kind: "blocked", message: blocked.message };
  }
  if (detail.networkingStatus === "do_not_contact") {
    return {
      kind: "blocked",
      message: "This contact is marked Do Not Contact. Email is blocked.",
    };
  }

  const { cooldownDays, maxOutreach } = outreachSettings(database, tenant);
  const warnings: OutreachWarning[] = [];
  const outbound = database
    .select()
    .from(interaction)
    .where(
      and(
        eq(interaction.workspaceId, tenant.workspaceId),
        eq(interaction.contactId, detail.id),
        eq(interaction.direction, "outbound"),
      ),
    )
    .orderBy(asc(interaction.occurredAt), asc(interaction.id))
    .all();
  const lastOutbound = outbound.at(-1);
  if (lastOutbound && isWithinCooldown(lastOutbound.occurredAt, now, cooldownDays)) {
    const lastInbound = database
      .select()
      .from(interaction)
      .where(
        and(
          eq(interaction.workspaceId, tenant.workspaceId),
          eq(interaction.contactId, detail.id),
          eq(interaction.direction, "inbound"),
        ),
      )
      .orderBy(asc(interaction.occurredAt), asc(interaction.id))
      .all()
      .at(-1);
    const opportunityRow = input.opportunityId
      ? getOpportunity(database, tenant, input.opportunityId)
      : null;
    warnings.push({
      kind: "cooldown",
      copy: formatCooldownWarning({
        contactName: detail.name,
        daysAgo: outreachDaysAgo(lastOutbound.occurredAt, now),
        companyName: opportunityRow?.companyName ?? detail.companyName,
        role: opportunityRow?.role ?? null,
        channelCounts: channelCountsForContact(database, tenant, detail.id),
        lastChannel: lastOutbound.channel,
        lastResponseBody: lastInbound?.body ?? null,
      }),
      lastChannel: lastOutbound.channel,
      lastResponseBody: lastInbound?.body ?? null,
    });
  }

  const opportunityId = input.opportunityId?.trim() || null;
  if (opportunityId) {
    const ownedOpportunity = database
      .select({ id: opportunity.id, companyId: opportunity.companyId })
      .from(opportunity)
      .where(
        and(
          eq(opportunity.workspaceId, tenant.workspaceId),
          eq(opportunity.id, opportunityId),
        ),
      )
      .get();
    if (ownedOpportunity) {
      const contacted = new Set(
        database
          .select({ contactId: interaction.contactId })
          .from(interaction)
          .innerJoin(
            contact,
            and(
              eq(contact.workspaceId, interaction.workspaceId),
              eq(contact.id, interaction.contactId),
            ),
          )
          .where(
            and(
              eq(interaction.workspaceId, tenant.workspaceId),
              eq(interaction.opportunityId, opportunityId),
              eq(interaction.direction, "outbound"),
              ne(interaction.contactId, detail.id),
            ),
          )
          .all()
          .map((row) => row.contactId)
          .filter((id): id is string => typeof id === "string"),
      );
      if (shouldWarnDuplicateOutreach(contacted.size, maxOutreach)) {
        warnings.push({
          kind: "duplicate_outreach",
          copy: formatDuplicateOutreachWarning(contacted.size),
          contactedCount: contacted.size,
        });
      }
    }
  }

  if (warnings.length === 0) return { kind: "ok" };
  return {
    kind: "warning",
    warnings,
    copy: warnings.map((warning) => warning.copy).join("\n\n"),
  };
}

export function logOutreachWarningOverride(
  database: AppDatabase,
  tenant: TenantContext,
  input: {
    contactId: string;
    opportunityId?: string | null;
    kinds: string[];
    now?: Date;
  },
): void {
  database.transaction((transaction) => {
    logEvent(transaction, tenant, {
      at: input.now ?? new Date(),
      kind: "OUTREACH_WARNING_OVERRIDDEN",
      entityType: "contact",
      entityId: input.contactId,
      payload: {
        opportunityId: input.opportunityId ?? null,
        kinds: input.kinds,
      },
    });
  });
}

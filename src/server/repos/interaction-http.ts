import {
  isInteractionChannel,
  isInteractionDirection,
} from "../../domain/interaction";
import type {
  CreateInteractionInput,
  Interaction,
} from "./interactions";

const LOG_FIELDS = new Set([
  "channel",
  "direction",
  "body",
  "requiresReply",
  "occurredAt",
  "companyId",
  "opportunityId",
  "referralId",
]);

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

function parsedInstant(value: unknown): Date | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}

export async function readCreateInteractionInput(
  request: Request,
): Promise<Omit<CreateInteractionInput, "contactId"> | null> {
  const body = await readObject(request);
  if (
    !body ||
    !Object.keys(body).every((key) => LOG_FIELDS.has(key)) ||
    !isInteractionChannel(body.channel) ||
    !isInteractionDirection(body.direction) ||
    ("body" in body && typeof body.body !== "string") ||
    ("requiresReply" in body && typeof body.requiresReply !== "boolean") ||
    ("companyId" in body &&
      body.companyId !== null &&
      typeof body.companyId !== "string") ||
    ("opportunityId" in body &&
      body.opportunityId !== null &&
      typeof body.opportunityId !== "string") ||
    ("referralId" in body &&
      body.referralId !== null &&
      typeof body.referralId !== "string") ||
    ("occurredAt" in body && parsedInstant(body.occurredAt) === undefined)
  ) {
    return null;
  }

  const occurredAt = parsedInstant(body.occurredAt);
  return {
    channel: body.channel,
    direction: body.direction,
    ...("body" in body ? { body: body.body as string } : {}),
    ...("requiresReply" in body
      ? { requiresReply: body.requiresReply as boolean }
      : {}),
    ...("companyId" in body ? { companyId: body.companyId as string | null } : {}),
    ...("opportunityId" in body
      ? { opportunityId: body.opportunityId as string | null }
      : {}),
    ...("referralId" in body
      ? { referralId: body.referralId as string | null }
      : {}),
    ...(occurredAt !== undefined && occurredAt !== null
      ? { occurredAt }
      : {}),
  };
}

export function interactionResponse(row: Interaction) {
  return {
    id: row.id,
    contactId: row.contactId,
    companyId: row.companyId,
    opportunityId: row.opportunityId,
    referralId: row.referralId,
    channel: row.channel,
    direction: row.direction,
    occurredAt: row.occurredAt.toISOString(),
    body: row.body,
    requiresReply: row.requiresReply,
    replyResolvedAt: row.replyResolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

import {
  isInteractionChannel,
  type InteractionChannel,
} from "../../domain/interaction";
import { isReferralStage, type ReferralStage } from "../../domain/referral";
import type {
  CreateReferralInput,
  ReferralListItem,
  UpdateReferralInput,
} from "./referrals";

const TEXT_FIELDS = [
  "contactId",
  "opportunityId",
  "requestedOn",
  "channel",
  "stage",
  "followUpOn",
  "receivedOn",
  "confirmation",
  "nextAction",
  "notes",
] as const;
const BOOLEAN_FIELDS = [
  "resumeShared",
  "jobIdShared",
  "jobUrlShared",
] as const;
const ALLOWED_FIELDS = new Set<string>([...TEXT_FIELDS, ...BOOLEAN_FIELDS]);

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

function validShape(body: Record<string, unknown>): boolean {
  if (!Object.keys(body).every((key) => ALLOWED_FIELDS.has(key))) {
    return false;
  }
  if (
    !TEXT_FIELDS.every(
      (field) =>
        !(field in body) ||
        typeof body[field] === "string" ||
        body[field] === null,
    )
  ) {
    return false;
  }
  return BOOLEAN_FIELDS.every(
    (field) => !(field in body) || typeof body[field] === "boolean",
  );
}

function optionalString(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!(key in body)) {
    return undefined;
  }
  const value = body[key];
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(
  body: Record<string, unknown>,
  key: string,
): boolean | undefined {
  if (!(key in body) || typeof body[key] !== "boolean") {
    return undefined;
  }
  return body[key] as boolean;
}

export async function readCreateReferralInput(
  request: Request,
): Promise<CreateReferralInput | null> {
  const body = await readObject(request);
  if (
    !body ||
    !validShape(body) ||
    typeof body.contactId !== "string" ||
    typeof body.channel !== "string" ||
    !isInteractionChannel(body.channel)
  ) {
    return null;
  }
  const stage = optionalString(body, "stage");
  if (stage && !isReferralStage(stage)) {
    return null;
  }
  return {
    contactId: body.contactId,
    channel: body.channel,
    opportunityId: optionalString(body, "opportunityId"),
    requestedOn: optionalString(body, "requestedOn"),
    resumeShared: optionalBoolean(body, "resumeShared"),
    jobIdShared: optionalBoolean(body, "jobIdShared"),
    jobUrlShared: optionalBoolean(body, "jobUrlShared"),
    stage: stage && isReferralStage(stage) ? stage : undefined,
    followUpOn: optionalString(body, "followUpOn"),
    receivedOn: optionalString(body, "receivedOn"),
    confirmation: optionalString(body, "confirmation"),
    nextAction: optionalString(body, "nextAction"),
    notes: optionalString(body, "notes"),
  };
}

export async function readUpdateReferralInput(
  request: Request,
): Promise<UpdateReferralInput | null> {
  const body = await readObject(request);
  if (!body || !validShape(body)) {
    return null;
  }
  const channel = optionalString(body, "channel");
  if (
    channel &&
    !isInteractionChannel(channel) &&
    channel !== null
  ) {
    return null;
  }
  const stage = optionalString(body, "stage");
  if (stage && !isReferralStage(stage) && stage !== null) {
    return null;
  }
  const input: UpdateReferralInput = {};
  const contactId = optionalString(body, "contactId");
  if (contactId !== undefined) input.contactId = contactId ?? undefined;
  if ("opportunityId" in body)
    input.opportunityId = optionalString(body, "opportunityId");
  if ("requestedOn" in body)
    input.requestedOn = optionalString(body, "requestedOn");
  if (channel && isInteractionChannel(channel)) {
    input.channel = channel;
  }
  const resumeShared = optionalBoolean(body, "resumeShared");
  if (resumeShared !== undefined) input.resumeShared = resumeShared;
  const jobIdShared = optionalBoolean(body, "jobIdShared");
  if (jobIdShared !== undefined) input.jobIdShared = jobIdShared;
  const jobUrlShared = optionalBoolean(body, "jobUrlShared");
  if (jobUrlShared !== undefined) input.jobUrlShared = jobUrlShared;
  if (stage && isReferralStage(stage)) input.stage = stage;
  if ("followUpOn" in body)
    input.followUpOn = optionalString(body, "followUpOn");
  if ("receivedOn" in body)
    input.receivedOn = optionalString(body, "receivedOn");
  if ("confirmation" in body)
    input.confirmation = optionalString(body, "confirmation");
  if ("nextAction" in body)
    input.nextAction = optionalString(body, "nextAction");
  if ("notes" in body) input.notes = optionalString(body, "notes");
  return input;
}

export function referralResponse(row: ReferralListItem) {
  const { workspaceId: _workspaceId, ...safe } = row;
  void _workspaceId;
  return {
    ...safe,
    createdAt: row.createdAt.toISOString(),
  };
}

export type { InteractionChannel, ReferralStage };

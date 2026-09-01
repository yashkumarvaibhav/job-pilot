import type {
  CreateOpportunityFromConversationInput,
  CreateOpportunityInput,
  LinkedContact,
  OpportunityListItem,
  UpdateOpportunityInput,
} from "./opportunities";

const TEXT_FIELDS = [
  "companyId",
  "role",
  "jobId",
  "url",
  "location",
  "workMode",
  "employmentType",
  "experienceRequirement",
  "source",
  "discoveredOn",
  "postedOn",
  "deadlineOn",
  "compensation",
  "priority",
  "eligibility",
  "resumeVersionId",
  "jdSnapshot",
  "notes",
  "bucket",
  "stage",
  "nextAction",
] as const;
const ALLOWED_FIELDS = new Set<string>([
  ...TEXT_FIELDS,
  "interestScore",
  "referralPreferred",
  "tags",
]);

async function readObject(request: Request): Promise<Record<string, unknown> | null> {
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
  if (!Object.keys(body).every((key) => ALLOWED_FIELDS.has(key))) return false;
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
  if (
    "interestScore" in body &&
    body.interestScore !== null &&
    typeof body.interestScore !== "number"
  ) {
    return false;
  }
  if (
    "referralPreferred" in body &&
    typeof body.referralPreferred !== "boolean"
  ) {
    return false;
  }
  return !(
    "tags" in body &&
    (!Array.isArray(body.tags) ||
      !body.tags.every((tag) => typeof tag === "string"))
  );
}

export async function readCreateOpportunityInput(
  request: Request,
): Promise<CreateOpportunityInput | null> {
  const body = await readObject(request);
  return body &&
    validShape(body) &&
    typeof body.companyId === "string" &&
    typeof body.role === "string"
    ? (body as CreateOpportunityInput)
    : null;
}

export async function readUpdateOpportunityInput(
  request: Request,
): Promise<UpdateOpportunityInput | null> {
  const body = await readObject(request);
  return body && validShape(body) ? (body as UpdateOpportunityInput) : null;
}

export function opportunityResponse(row: OpportunityListItem) {
  const { workspaceId: _workspaceId, tagsJson, ...safe } = row;
  void _workspaceId;
  return {
    ...safe,
    tags: tagsJson,
    createdAt: row.createdAt.toISOString(),
  };
}

const FROM_CONVERSATION_FIELDS = new Set([
  "contactId",
  "role",
  "jobId",
  "companyId",
]);

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

export async function readFromConversationInput(
  request: Request,
): Promise<CreateOpportunityFromConversationInput | null> {
  const body = await readObject(request);
  if (
    !body ||
    !Object.keys(body).every((key) => FROM_CONVERSATION_FIELDS.has(key)) ||
    typeof body.contactId !== "string" ||
    typeof body.role !== "string"
  ) {
    return null;
  }
  const jobId = optionalString(body, "jobId");
  const companyId = optionalString(body, "companyId");
  if (jobId === undefined && "jobId" in body) {
    return null;
  }
  if (companyId === undefined && "companyId" in body) {
    return null;
  }
  return {
    contactId: body.contactId,
    role: body.role,
    ...(jobId !== undefined ? { jobId } : {}),
    ...(companyId !== undefined ? { companyId } : {}),
  };
}

export async function readLinkContactInput(
  request: Request,
): Promise<{ contactId: string } | null> {
  const body = await readObject(request);
  if (
    !body ||
    !Object.keys(body).every((key) => key === "contactId") ||
    typeof body.contactId !== "string"
  ) {
    return null;
  }
  return { contactId: body.contactId };
}

export function linkedContactResponse(row: LinkedContact) {
  return {
    linkId: row.linkId,
    opportunityId: row.opportunityId,
    contactId: row.contactId,
    contactName: row.contactName,
    companyName: row.companyName,
    createdAt: row.createdAt.toISOString(),
  };
}

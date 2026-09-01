import type {
  CreateOpportunityInput,
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

import type {
  ApplicationListItem,
  ApplyToOpportunityInput,
  UpdateApplicationInput,
} from "./applications";

const APPLY_TEXT_FIELDS = [
  "opportunityId",
  "portal",
  "appliedOn",
  "applicationExternalId",
  "referrer",
  "resumeVersionId",
  "notes",
] as const;

const UPDATE_TEXT_FIELDS = [
  "portal",
  "appliedOn",
  "applicationExternalId",
  "referrer",
  "resumeVersionId",
  "notes",
  "stage",
  "offerDeadlineOn",
  "offerDecision",
] as const;

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

function stringsOrNull(
  body: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.every(
    (field) =>
      !(field in body) ||
      typeof body[field] === "string" ||
      body[field] === null,
  );
}

export async function readApplyInput(
  request: Request,
): Promise<ApplyToOpportunityInput | null> {
  const body = await readObject(request);
  if (
    !body ||
    !Object.keys(body).every((key) =>
      (APPLY_TEXT_FIELDS as readonly string[]).includes(key),
    ) ||
    !stringsOrNull(body, APPLY_TEXT_FIELDS) ||
    typeof body.opportunityId !== "string" ||
    typeof body.portal !== "string" ||
    typeof body.appliedOn !== "string"
  ) {
    return null;
  }
  return body as ApplyToOpportunityInput;
}

export async function readUpdateApplicationInput(
  request: Request,
): Promise<UpdateApplicationInput | null> {
  const body = await readObject(request);
  if (
    !body ||
    !Object.keys(body).every((key) =>
      (UPDATE_TEXT_FIELDS as readonly string[]).includes(key),
    ) ||
    !stringsOrNull(body, UPDATE_TEXT_FIELDS)
  ) {
    return null;
  }
  return body as UpdateApplicationInput;
}

export function applicationResponse(row: ApplicationListItem) {
  const { workspaceId: _workspaceId, ...safe } = row;
  void _workspaceId;
  return {
    ...safe,
    createdAt: row.createdAt.toISOString(),
  };
}

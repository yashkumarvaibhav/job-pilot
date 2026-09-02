import type {
  CreateAssessmentInput,
  AssessmentListItem,
  UpdateAssessmentInput,
} from "./assessments";

const CREATE_FIELDS = [
  "opportunityId",
  "applicationId",
  "kind",
  "platform",
  "invitedAt",
  "windowOpensAt",
  "windowOpensDateOn",
  "windowOpensTime",
  "dueAt",
  "dateOn",
  "time",
  "durationMinutes",
  "status",
  "result",
  "notes",
] as const;

const UPDATE_FIELDS = CREATE_FIELDS.filter(
  (field) => field !== "opportunityId",
);

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

export async function readCreateAssessmentInput(
  request: Request,
): Promise<CreateAssessmentInput | null> {
  const body = await readObject(request);
  if (
    !body ||
    !Object.keys(body).every((key) =>
      (CREATE_FIELDS as readonly string[]).includes(key),
    ) ||
    !stringsOrNull(body, CREATE_FIELDS) ||
    typeof body.opportunityId !== "string" ||
    typeof body.kind !== "string"
  ) {
    return null;
  }
  return {
    opportunityId: body.opportunityId,
    kind: body.kind,
    applicationId: optionalString(body, "applicationId"),
    platform: optionalString(body, "platform"),
    invitedAt: optionalString(body, "invitedAt"),
    windowOpensAt: optionalString(body, "windowOpensAt"),
    windowOpensDateOn: optionalString(body, "windowOpensDateOn"),
    windowOpensTime: optionalString(body, "windowOpensTime"),
    dueAt: optionalString(body, "dueAt"),
    dateOn: optionalString(body, "dateOn"),
    time: optionalString(body, "time"),
    durationMinutes: optionalString(body, "durationMinutes"),
    status: optionalString(body, "status"),
    result: optionalString(body, "result"),
    notes: optionalString(body, "notes"),
  };
}

export async function readUpdateAssessmentInput(
  request: Request,
): Promise<UpdateAssessmentInput | null> {
  const body = await readObject(request);
  if (
    !body ||
    !Object.keys(body).every((key) =>
      (UPDATE_FIELDS as readonly string[]).includes(key),
    ) ||
    !stringsOrNull(body, UPDATE_FIELDS)
  ) {
    return null;
  }
  return {
    applicationId: optionalString(body, "applicationId"),
    kind: optionalString(body, "kind") ?? undefined,
    platform: optionalString(body, "platform"),
    invitedAt: optionalString(body, "invitedAt"),
    windowOpensAt: optionalString(body, "windowOpensAt"),
    windowOpensDateOn: optionalString(body, "windowOpensDateOn"),
    windowOpensTime: optionalString(body, "windowOpensTime"),
    dueAt: optionalString(body, "dueAt"),
    dateOn: optionalString(body, "dateOn"),
    time: optionalString(body, "time"),
    durationMinutes: optionalString(body, "durationMinutes"),
    status: optionalString(body, "status"),
    result: optionalString(body, "result"),
    notes: optionalString(body, "notes"),
  };
}

export function assessmentResponse(row: AssessmentListItem) {
  const { workspaceId: _workspaceId, ...safe } = row;
  void _workspaceId;
  return {
    ...safe,
    invitedAt: row.invitedAt ? row.invitedAt.toISOString() : null,
    windowOpensAt: row.windowOpensAt ? row.windowOpensAt.toISOString() : null,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

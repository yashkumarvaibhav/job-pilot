import type {
  CreateInterviewInput,
  InterviewListItem,
  UpdateInterviewInput,
} from "./interviews";

const CREATE_FIELDS = [
  "opportunityId",
  "kind",
  "at",
  "dateOn",
  "time",
  "meetingUrl",
  "interviewer",
  "questions",
  "prepNotes",
  "performance",
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

export async function readCreateInterviewInput(
  request: Request,
): Promise<CreateInterviewInput | null> {
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
    at: optionalString(body, "at"),
    dateOn: optionalString(body, "dateOn"),
    time: optionalString(body, "time"),
    meetingUrl: optionalString(body, "meetingUrl"),
    interviewer: optionalString(body, "interviewer"),
    questions: optionalString(body, "questions"),
    prepNotes: optionalString(body, "prepNotes"),
    performance: optionalString(body, "performance"),
    result: optionalString(body, "result"),
    notes: optionalString(body, "notes"),
  };
}

export async function readUpdateInterviewInput(
  request: Request,
): Promise<UpdateInterviewInput | null> {
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
    kind: optionalString(body, "kind") ?? undefined,
    at: optionalString(body, "at"),
    dateOn: optionalString(body, "dateOn"),
    time: optionalString(body, "time"),
    meetingUrl: optionalString(body, "meetingUrl"),
    interviewer: optionalString(body, "interviewer"),
    questions: optionalString(body, "questions"),
    prepNotes: optionalString(body, "prepNotes"),
    performance: optionalString(body, "performance"),
    result: optionalString(body, "result"),
    notes: optionalString(body, "notes"),
  };
}

export function interviewResponse(row: InterviewListItem) {
  const { workspaceId: _workspaceId, ...safe } = row;
  void _workspaceId;
  return {
    ...safe,
    at: row.at ? row.at.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

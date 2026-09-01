import {
  isTaskLinkType,
  isTaskPriority,
  isTaskSource,
  type TaskLinkType,
  type TaskPriority,
  type TaskSource,
} from "../../domain/task";
import type {
  CreateTaskInput,
  DueItem,
  TaskListItem,
  UpdateTaskInput,
} from "./tasks";

const CREATE_FIELDS = [
  "title",
  "description",
  "dueOn",
  "priority",
  "source",
  "entityType",
  "entityId",
] as const;
const UPDATE_FIELDS = CREATE_FIELDS;
const CONVERT_FIELDS = ["sourceKey"] as const;

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

function hasOnly(
  body: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const names = new Set(allowed);
  return Object.keys(body).every((key) => names.has(key));
}

export async function readCreateTaskInput(
  request: Request,
): Promise<CreateTaskInput | null> {
  const body = await readObject(request);
  if (!body || !hasOnly(body, CREATE_FIELDS) || typeof body.title !== "string") {
    return null;
  }
  const priority = optionalString(body, "priority");
  const source = optionalString(body, "source");
  const entityType = optionalString(body, "entityType");
  if (priority && !isTaskPriority(priority)) {
    return null;
  }
  if (source && !isTaskSource(source)) {
    return null;
  }
  if (entityType && !isTaskLinkType(entityType) && entityType !== null) {
    return null;
  }
  return {
    title: body.title,
    description: optionalString(body, "description"),
    dueOn: optionalString(body, "dueOn"),
    priority: priority && isTaskPriority(priority) ? priority : undefined,
    source: source && isTaskSource(source) ? source : undefined,
    entityType:
      entityType && isTaskLinkType(entityType) ? entityType : entityType === null
        ? null
        : undefined,
    entityId: optionalString(body, "entityId"),
  };
}

export async function readUpdateTaskInput(
  request: Request,
): Promise<UpdateTaskInput | null> {
  const body = await readObject(request);
  if (!body || !hasOnly(body, UPDATE_FIELDS)) {
    return null;
  }
  const input: UpdateTaskInput = {};
  const title = optionalString(body, "title");
  if (title !== undefined) input.title = title ?? undefined;
  if ("description" in body) input.description = optionalString(body, "description");
  if ("dueOn" in body) input.dueOn = optionalString(body, "dueOn");
  const priority = optionalString(body, "priority");
  if (priority && isTaskPriority(priority)) input.priority = priority;
  const source = optionalString(body, "source");
  if (source && isTaskSource(source)) input.source = source;
  const entityType = optionalString(body, "entityType");
  if (entityType && isTaskLinkType(entityType)) input.entityType = entityType;
  if (entityType === null) input.entityType = null;
  if ("entityId" in body) input.entityId = optionalString(body, "entityId");
  return input;
}

export async function readConvertDerivedInput(
  request: Request,
): Promise<{ sourceKey: string } | null> {
  const body = await readObject(request);
  if (
    !body ||
    !hasOnly(body, CONVERT_FIELDS) ||
    typeof body.sourceKey !== "string"
  ) {
    return null;
  }
  return { sourceKey: body.sourceKey };
}

export function taskResponse(row: TaskListItem | TaskRow) {
  const { workspaceId: _workspaceId, ...safe } = row;
  void _workspaceId;
  return {
    ...safe,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

type TaskRow = {
  workspaceId: string;
  createdAt: Date;
  completedAt: Date | null;
  [key: string]: unknown;
};

export function dueItemResponse(row: DueItem) {
  return row;
}

export type { TaskLinkType, TaskPriority, TaskSource };

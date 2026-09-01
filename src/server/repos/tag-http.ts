import { isTagEntityType, type TagEntityType } from "../../domain/tag";
import type { Tag, TaggedLabel } from "./tags";

export type AttachTagBody = {
  label: string;
  entityType: TagEntityType;
  entityId: string;
};

export type DetachTagBody = {
  tagId: string;
  entityType: TagEntityType;
  entityId: string;
};

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

export async function readAttachTagInput(
  request: Request,
): Promise<AttachTagBody | null> {
  const body = await readObject(request);
  if (
    !body ||
    typeof body.label !== "string" ||
    !isTagEntityType(body.entityType) ||
    typeof body.entityId !== "string"
  ) {
    return null;
  }
  return {
    label: body.label,
    entityType: body.entityType,
    entityId: body.entityId,
  };
}

export async function readDetachTagInput(
  request: Request,
): Promise<DetachTagBody | null> {
  const body = await readObject(request);
  if (
    !body ||
    typeof body.tagId !== "string" ||
    !isTagEntityType(body.entityType) ||
    typeof body.entityId !== "string"
  ) {
    return null;
  }
  return {
    tagId: body.tagId,
    entityType: body.entityType,
    entityId: body.entityId,
  };
}

export function tagResponse(row: Tag) {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
  };
}

export function taggedLabelResponse(row: TaggedLabel) {
  return { tagId: row.tagId, label: row.label };
}

import type { DueSourceKind } from "../../domain/due-source";
import { DUE_SOURCE_KINDS } from "../../domain/due-source";
import type { NotificationListItem } from "./notifications";

const SNOOZE_FIELDS = ["ids", "preset", "until"] as const;
const IDS_FIELDS = ["ids"] as const;
const MUTE_FIELDS = ["kind"] as const;

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

function hasOnly(
  body: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const names = new Set(allowed);
  return Object.keys(body).every((key) => names.has(key));
}

function readIds(body: Record<string, unknown>): string[] | null {
  const ids = body.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.some((id) => typeof id !== "string" || id.trim().length === 0)
  ) {
    return null;
  }
  return ids.map((id) => (id as string).trim());
}

export async function readSnoozeInput(
  request: Request,
): Promise<{ ids: string[]; preset?: string; until?: string } | null> {
  const body = await readObject(request);
  if (!body || !hasOnly(body, SNOOZE_FIELDS)) {
    return null;
  }
  const ids = readIds(body);
  if (!ids) {
    return null;
  }
  const preset = typeof body.preset === "string" ? body.preset : undefined;
  const until = typeof body.until === "string" ? body.until : undefined;
  if (!preset && !until) {
    return null;
  }
  return { ids, preset, until };
}

export async function readIdsInput(
  request: Request,
): Promise<{ ids: string[] } | null> {
  const body = await readObject(request);
  if (!body || !hasOnly(body, IDS_FIELDS)) {
    return null;
  }
  const ids = readIds(body);
  return ids ? { ids } : null;
}

export async function readMuteInput(
  request: Request,
): Promise<{ kind: DueSourceKind } | null> {
  const body = await readObject(request);
  if (!body || !hasOnly(body, MUTE_FIELDS) || typeof body.kind !== "string") {
    return null;
  }
  return DUE_SOURCE_KINDS.includes(body.kind as DueSourceKind)
    ? { kind: body.kind as DueSourceKind }
    : null;
}

export function notificationResponse(row: NotificationListItem) {
  return {
    id: row.id,
    kind: row.kind,
    entityType: row.entityType,
    entityId: row.entityId,
    title: row.title,
    body: row.body,
    dueOn: row.dueOn,
    dueAt: row.dueAt.toISOString(),
    dueKey: row.dueKey,
    groupKey: row.groupKey,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    snoozedUntil: row.snoozedUntil ? row.snoozedUntil.toISOString() : null,
    dismissedAt: row.dismissedAt ? row.dismissedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    muted: row.muted,
  };
}

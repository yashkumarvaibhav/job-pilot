import type { WorkspaceSettingsView } from "./settings";
import { formatClockMinutes } from "../../domain/settings";

const SETTINGS_FIELDS = [
  "displayName",
  "university",
  "timezone",
  "quietStart",
  "quietEnd",
] as const;

export type SettingsRequestInput = {
  displayName: string;
  university?: string;
  timezone?: string;
  quietStart?: string;
  quietEnd?: string;
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

/**
 * Every accepted field is a string the workspace typed. A `workspaceId` — or any
 * other key — is refused here rather than silently dropped, so a client that tries
 * to name someone else's workspace gets a 400 instead of a quiet success (D-035).
 */
export async function readSettingsInput(
  request: Request,
): Promise<SettingsRequestInput | null> {
  const body = await readObject(request);
  if (!body) {
    return null;
  }
  const allowed = new Set<string>(SETTINGS_FIELDS);
  if (!Object.keys(body).every((key) => allowed.has(key))) {
    return null;
  }
  if (
    SETTINGS_FIELDS.some(
      (field) => body[field] !== undefined && typeof body[field] !== "string",
    )
  ) {
    return null;
  }
  if (typeof body.displayName !== "string") {
    return null;
  }
  return {
    displayName: body.displayName,
    university: body.university as string | undefined,
    timezone: body.timezone as string | undefined,
    quietStart: body.quietStart as string | undefined,
    quietEnd: body.quietEnd as string | undefined,
  };
}

export function settingsResponse(view: WorkspaceSettingsView) {
  return {
    displayName: view.displayName,
    university: view.university,
    timezone: view.timezone,
    quietStart:
      view.quietStart == null ? null : formatClockMinutes(view.quietStart),
    quietEnd: view.quietEnd == null ? null : formatClockMinutes(view.quietEnd),
  };
}

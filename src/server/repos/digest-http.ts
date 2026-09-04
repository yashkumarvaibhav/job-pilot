import type { DigestPolicyView, DigestPreview } from "./digest";

const DIGEST_FIELDS = [
  "digestHour",
  "digestAccountId",
  "digestEmailEnabled",
] as const;

export type DigestRequestInput = {
  digestHour?: string | number | null;
  digestAccountId?: string | null;
  digestEmailEnabled?: boolean;
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

export async function readDigestInput(
  request: Request,
): Promise<DigestRequestInput | null> {
  const body = await readObject(request);
  if (!body) {
    return null;
  }
  const allowed = new Set<string>(DIGEST_FIELDS);
  if (!Object.keys(body).every((key) => allowed.has(key))) {
    return null;
  }
  if (
    body.digestHour !== undefined &&
    body.digestHour !== null &&
    typeof body.digestHour !== "string" &&
    typeof body.digestHour !== "number"
  ) {
    return null;
  }
  if (
    body.digestAccountId !== undefined &&
    body.digestAccountId !== null &&
    typeof body.digestAccountId !== "string"
  ) {
    return null;
  }
  if (
    body.digestEmailEnabled !== undefined &&
    typeof body.digestEmailEnabled !== "boolean"
  ) {
    return null;
  }
  return {
    digestHour: body.digestHour as string | number | null | undefined,
    digestAccountId: body.digestAccountId as string | null | undefined,
    digestEmailEnabled: body.digestEmailEnabled as boolean | undefined,
  };
}

export function digestPolicyResponse(view: DigestPolicyView) {
  return {
    digestHour: view.digestHour,
    digestEmailEnabled: view.digestEmailEnabled,
    digestAccountId: view.digestAccountId,
    digestAccountEmail: view.digestAccountEmail,
    selectedAccountStatus: view.selectedAccountStatus,
    selectedAccountLiveEmail: view.selectedAccountLiveEmail,
  };
}

export function digestPreviewResponse(view: DigestPreview) {
  return {
    asOfOn: view.asOfOn,
    timeZone: view.timeZone,
    counts: view.counts,
    body: view.body,
    lastRun: view.lastRun
      ? {
          localDate: view.lastRun.localDate,
          outcome: view.lastRun.outcome,
          at: view.lastRun.at.toISOString(),
        }
      : null,
  };
}

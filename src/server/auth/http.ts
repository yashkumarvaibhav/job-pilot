/**
 * Request parsing for the account-access routes. The user-facing copy lives in
 * `src/lib/account.ts` so the forms and the routes cannot drift apart.
 */
export type Credentials = {
  username: string;
  password: string;
};

/**
 * JSON only. A browser can post a cross-site form but cannot set this content
 * type without CORS, which keeps the mutating routes off the simple-request
 * path until JP-0048 adds the explicit origin check.
 */
export async function readCredentials(
  request: Request,
): Promise<Credentials | null> {
  const body = await readJsonObject(request);
  if (!body) return null;

  const { username, password } = body;

  return typeof username === "string" && typeof password === "string"
    ? { username, password }
    : null;
}

export async function readTotpCode(
  request: Request,
): Promise<{ code: string } | null> {
  const body = await readJsonObject(request);
  return body && typeof body.code === "string" ? { code: body.code } : null;
}

export async function readTotpPasswordReset(
  request: Request,
): Promise<{ username: string; code: string; password: string } | null> {
  const body = await readJsonObject(request);
  return body &&
    typeof body.username === "string" &&
    typeof body.code === "string" &&
    typeof body.password === "string"
    ? { username: body.username, code: body.code, password: body.password }
    : null;
}

export async function readTotpPasswordChange(
  request: Request,
): Promise<{
  currentPassword: string;
  code: string;
  newPassword: string;
} | null> {
  const body = await readJsonObject(request);
  return body &&
    typeof body.currentPassword === "string" &&
    typeof body.code === "string" &&
    typeof body.newPassword === "string"
    ? {
        currentPassword: body.currentPassword,
        code: body.code,
        newPassword: body.newPassword,
      }
    : null;
}

async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return null;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return null;
  }

  if (typeof body !== "object" || body === null) {
    return null;
  }

  return body as Record<string, unknown>;
}

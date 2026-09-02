/**
 * Request parsing for the account-access routes. The user-facing copy lives in
 * `src/lib/account.ts` so the forms and the routes cannot drift apart.
 */
export type Credentials = {
  email: string;
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

  const { email, password } = body;

  return typeof email === "string" && typeof password === "string"
    ? { email, password }
    : null;
}

export async function readEmail(
  request: Request,
): Promise<{ email: string } | null> {
  const body = await readJsonObject(request);
  return body && typeof body.email === "string"
    ? { email: body.email }
    : null;
}

export async function readToken(
  request: Request,
): Promise<{ token: string } | null> {
  const body = await readJsonObject(request);
  return body && typeof body.token === "string"
    ? { token: body.token }
    : null;
}

export async function readPasswordReset(
  request: Request,
): Promise<{ token: string; password: string } | null> {
  const body = await readJsonObject(request);
  return body &&
    typeof body.token === "string" &&
    typeof body.password === "string"
    ? { token: body.token, password: body.password }
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

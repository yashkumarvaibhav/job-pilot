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

  const { email, password } = body as Record<string, unknown>;

  return typeof email === "string" && typeof password === "string"
    ? { email, password }
    : null;
}

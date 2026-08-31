/**
 * Copy shared by the account-access screens and their routes. Login and
 * signup answer with one message each so neither becomes an address oracle
 * (§62, D-035); JP-0048 adds rate limiting behind the same wording.
 */
export const SIGNUP_FAILED_MESSAGE =
  "Could not create that account. Check your details and try again.";
export const LOGIN_FAILED_MESSAGE = "Email or password not recognised";
export const REQUEST_FAILED_MESSAGE = "Something went wrong. Try again.";

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

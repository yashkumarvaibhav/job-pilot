/**
 * Account-access facts and copy shared by the browser forms and the server.
 * They live outside `src/server` so a client component can import them without
 * dragging `node:crypto` into the bundle.
 *
 * Login and signup answer with one message each: a distinct "already
 * registered" or "no such account" reply would turn either form into an
 * address oracle (§62, D-035). JP-0048 adds rate limiting behind this wording.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

export const SIGNUP_FAILED_MESSAGE =
  "Could not create that account. Check your details and try again.";
export const LOGIN_FAILED_MESSAGE = "Email or password not recognised";
export const REQUEST_FAILED_MESSAGE = "Something went wrong. Try again.";

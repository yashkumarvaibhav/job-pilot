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
export const ACCOUNT_MAIL_UNAVAILABLE_MESSAGE =
  "Account email is temporarily unavailable. Try again later.";
export const SIGNUP_CHECK_EMAIL_MESSAGE =
  "Check your email to verify your account before signing in.";
export const VERIFICATION_REQUESTED_MESSAGE =
  "If that account needs verification, a new link has been sent.";
export const RECOVERY_REQUESTED_MESSAGE =
  "If an account matches that email, a reset link has been sent.";
export const VERIFICATION_FAILED_MESSAGE =
  "That verification link is invalid or has expired.";
export const PASSWORD_RESET_FAILED_MESSAGE =
  "That reset link is invalid or has expired.";
export const PASSWORD_RESET_COMPLETE_MESSAGE =
  "Password reset. Sign in with your new password.";

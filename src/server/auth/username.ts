export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])$/;

/** Public signup grammar. Email-shaped values are deliberately excluded. */
export function normalizeUsername(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length >= USERNAME_MIN_LENGTH &&
    normalized.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(normalized)
    ? normalized
    : null;
}

/**
 * Login/recovery also accept grandfathered identifiers migrated from the former
 * email-shaped account column. New signup never reaches this broader parser.
 */
export function normalizeAccountIdentifier(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < USERNAME_MIN_LENGTH ||
    normalized.length > 254 ||
    /\s|[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

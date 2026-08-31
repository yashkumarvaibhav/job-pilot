/**
 * The normalised address is the globally unique account identity (D-035), so
 * it is deliberately conservative: one `@`, no whitespace, a dotted domain.
 */
const ADDRESS = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const MAX_LENGTH = 254;

export function normalizeEmail(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();

  if (normalized.length === 0 || normalized.length > MAX_LENGTH) {
    return null;
  }

  return ADDRESS.test(normalized) ? normalized : null;
}

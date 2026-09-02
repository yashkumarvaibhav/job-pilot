import {
  ACCOUNT_RATE_LIMITS,
  RATE_LIMITED_MESSAGE,
  accountRateLimiter,
  type AccountRateLimitCategory,
} from "../../domain/rate-limit";
import { normalizeEmail } from "./email";

/**
 * Two counters per attempt: one for the address being tried and one for the
 * caller. Either alone is easy to walk around — an attacker with many addresses
 * defeats the account key, and one behind a proxy pool defeats the IP key.
 */
function keysFor(
  category: AccountRateLimitCategory,
  request: Request,
  email: string | null | undefined,
): string[] {
  const keys = [`${category}:ip:${clientAddress(request)}`];
  const normalized = email ? normalizeEmail(email) : null;
  if (normalized) {
    keys.push(`${category}:account:${normalized}`);
  }
  return keys;
}

/**
 * `x-forwarded-for` is only trustworthy because the app is reached through the
 * owner's own tunnel; the left-most entry is the client the edge saw. With no
 * header at all every caller shares one bucket, which fails closed rather than
 * open.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0
    ? first
    : (request.headers.get("x-real-ip")?.trim() ?? "unknown");
}

export type RateLimitGuard = {
  limited: boolean;
  retryAfterSeconds: number;
  recordFailure: () => void;
  recordSuccess: () => void;
};

export function guardAccountAttempt(
  category: AccountRateLimitCategory,
  request: Request,
  email: string | null | undefined,
  now: Date = new Date(),
): RateLimitGuard {
  const rule = ACCOUNT_RATE_LIMITS[category];
  const keys = keysFor(category, request, email);
  const verdicts = keys.map((key) => accountRateLimiter.check(key, rule, now));
  const blocked = verdicts.filter((verdict) => !verdict.allowed);

  return {
    limited: blocked.length > 0,
    // The longest wait, so the answer does not narrow down which counter it was.
    retryAfterSeconds: Math.ceil(
      Math.max(0, ...blocked.map((verdict) => verdict.retryAfterMs)) / 1_000,
    ),
    recordFailure: () => {
      for (const key of keys) {
        accountRateLimiter.recordFailure(key, rule, now);
      }
    },
    recordSuccess: () => {
      for (const key of keys) {
        accountRateLimiter.reset(key);
      }
    },
  };
}

export { RATE_LIMITED_MESSAGE };

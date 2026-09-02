/**
 * Bounded attempt counting for the account endpoints (§62).
 *
 * Counters live in this process. `next start` serves Job Pilot from one Node
 * process, so a shared store would buy nothing a restart does not already
 * concede, and a restart is not something an attacker can trigger. If the
 * deployment ever forks, this becomes a database table rather than a Map.
 */

export type RateLimitRule = {
  /** Failures allowed inside the window before the key is locked. */
  limit: number;
  windowMs: number;
  lockoutMs: number;
};

export type RateLimitVerdict = {
  allowed: boolean;
  retryAfterMs: number;
};

export const ACCOUNT_RATE_LIMITS = {
  login: { limit: 5, windowMs: 15 * 60_000, lockoutMs: 15 * 60_000 },
  signup: { limit: 5, windowMs: 60 * 60_000, lockoutMs: 60 * 60_000 },
  recovery: { limit: 5, windowMs: 60 * 60_000, lockoutMs: 60 * 60_000 },
  verification: { limit: 5, windowMs: 60 * 60_000, lockoutMs: 60 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type AccountRateLimitCategory = keyof typeof ACCOUNT_RATE_LIMITS;

/**
 * Says nothing about which key tripped, or whether the address exists. A caller
 * that varies this string by cause hands an attacker an enumeration oracle.
 */
export const RATE_LIMITED_MESSAGE =
  "Too many attempts. Wait a few minutes and try again.";

type Entry = {
  failures: number[];
  lockedUntil: number;
};

export class RateLimiter {
  readonly #entries = new Map<string, Entry>();

  get size(): number {
    return this.#entries.size;
  }

  check(key: string, rule: RateLimitRule, now: Date = new Date()): RateLimitVerdict {
    this.#sweep(now, rule);
    const entry = this.#entries.get(key);
    if (!entry) {
      return { allowed: true, retryAfterMs: 0 };
    }

    const at = now.getTime();
    if (entry.lockedUntil > at) {
      return { allowed: false, retryAfterMs: entry.lockedUntil - at };
    }

    const recent = entry.failures.filter((when) => when > at - rule.windowMs);
    if (recent.length >= rule.limit) {
      return { allowed: false, retryAfterMs: rule.lockoutMs };
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  recordFailure(key: string, rule: RateLimitRule, now: Date = new Date()): void {
    const at = now.getTime();
    const entry = this.#entries.get(key) ?? { failures: [], lockedUntil: 0 };
    entry.failures = [
      ...entry.failures.filter((when) => when > at - rule.windowMs),
      at,
    ];
    if (entry.failures.length >= rule.limit) {
      entry.lockedUntil = at + rule.lockoutMs;
    }
    this.#entries.set(key, entry);
  }

  /** A success clears the slate for that key. */
  reset(key: string): void {
    this.#entries.delete(key);
  }

  #sweep(now: Date, rule: RateLimitRule): void {
    const at = now.getTime();
    for (const [key, entry] of this.#entries) {
      const stale =
        entry.lockedUntil <= at &&
        entry.failures.every((when) => when <= at - rule.windowMs);
      if (stale) {
        this.#entries.delete(key);
      }
    }
  }
}

/** One counter per process, shared by the account routes. */
export const accountRateLimiter = new RateLimiter();

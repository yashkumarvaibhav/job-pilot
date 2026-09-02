import { describe, expect, it } from "vitest";

import {
  ACCOUNT_RATE_LIMITS,
  RATE_LIMITED_MESSAGE,
  RateLimiter,
} from "./rate-limit";

const RULE = { limit: 5, windowMs: 60_000, lockoutMs: 300_000 };
const START = new Date("2026-09-02T10:00:00.000Z");

function at(offsetMs: number): Date {
  return new Date(START.getTime() + offsetMs);
}

describe("RateLimiter", () => {
  it("allows attempts up to the limit and locks the one after", () => {
    const limiter = new RateLimiter();

    for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
      expect(limiter.check("login:a@invalid.test", RULE, START).allowed).toBe(
        true,
      );
      limiter.recordFailure("login:a@invalid.test", RULE, START);
    }

    const blocked = limiter.check("login:a@invalid.test", RULE, START);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(RULE.lockoutMs);
  });

  it("keys are independent, so one account cannot lock out another", () => {
    const limiter = new RateLimiter();

    for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
      limiter.recordFailure("login:a@invalid.test", RULE, START);
    }

    expect(limiter.check("login:a@invalid.test", RULE, START).allowed).toBe(
      false,
    );
    expect(limiter.check("login:b@invalid.test", RULE, START).allowed).toBe(
      true,
    );
    expect(limiter.check("ip:198.51.100.7", RULE, START).allowed).toBe(true);
  });

  it("lets the lockout expire rather than banning forever", () => {
    const limiter = new RateLimiter();
    for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
      limiter.recordFailure("login:a@invalid.test", RULE, START);
    }

    expect(
      limiter.check("login:a@invalid.test", RULE, at(RULE.lockoutMs - 1)).allowed,
    ).toBe(false);
    expect(
      limiter.check("login:a@invalid.test", RULE, at(RULE.lockoutMs + 1)).allowed,
    ).toBe(true);
  });

  it("forgets failures that fall out of the window", () => {
    const limiter = new RateLimiter();

    limiter.recordFailure("login:a@invalid.test", RULE, START);
    limiter.recordFailure("login:a@invalid.test", RULE, at(1_000));
    // These two age out before the next three arrive.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      limiter.recordFailure(
        "login:a@invalid.test",
        RULE,
        at(RULE.windowMs + 2_000),
      );
    }

    expect(
      limiter.check("login:a@invalid.test", RULE, at(RULE.windowMs + 2_000))
        .allowed,
    ).toBe(true);
  });

  it("clears a key on success so a good login is not punished later", () => {
    const limiter = new RateLimiter();
    for (let attempt = 0; attempt < RULE.limit - 1; attempt += 1) {
      limiter.recordFailure("login:a@invalid.test", RULE, START);
    }

    limiter.reset("login:a@invalid.test");

    for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
      expect(limiter.check("login:a@invalid.test", RULE, START).allowed).toBe(
        true,
      );
      limiter.recordFailure("login:a@invalid.test", RULE, START);
    }
  });

  it("does not grow without bound as keys age out", () => {
    const limiter = new RateLimiter();

    for (let index = 0; index < 500; index += 1) {
      limiter.recordFailure(`login:user-${index}`, RULE, START);
    }
    expect(limiter.size).toBe(500);

    // A later attempt sweeps everything whose window and lockout have passed.
    limiter.check("login:fresh", RULE, at(RULE.windowMs + RULE.lockoutMs + 1));
    expect(limiter.size).toBeLessThan(10);
  });

  it("publishes limits for every account endpoint and one generic message", () => {
    for (const category of [
      "login",
      "signup",
      "recovery",
      "verification",
    ] as const) {
      const rule = ACCOUNT_RATE_LIMITS[category];
      expect(rule.limit).toBeGreaterThan(0);
      expect(rule.windowMs).toBeGreaterThan(0);
      expect(rule.lockoutMs).toBeGreaterThan(0);
    }

    // The copy names neither an address nor which counter tripped.
    expect(RATE_LIMITED_MESSAGE).not.toMatch(/email|account|address|ip\b/i);
  });
});

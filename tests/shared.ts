/**
 * Values both browser suites need. `responsive/` audits every registered page
 * for layout and accessibility; `journeys/` drives the product the way a job
 * seeker actually uses it. They share one dev server and one seeded database,
 * so the server's address and the synthetic password live here rather than in
 * either suite's own fixture.
 */
export const BASE_URL = "http://127.0.0.1:3061";
export const ACCOUNT_PASSWORD = "synthetic-responsive-password";

/** Deterministic 32-byte key: the suites never touch a real TOKEN_KEY. */
export const TEST_TOKEN_KEY = Buffer.alloc(32, 21).toString("base64");

/** RFC 4226's test key, so a spec can compute a code the server will accept. */
export const TEST_TOTP_SECRET = "12345678901234567890";

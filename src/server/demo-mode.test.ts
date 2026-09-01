import { describe, expect, it } from "vitest";

import {
  DEMO_SIGNUP_CLOSED_MESSAGE,
  assertDemoConfiguration,
  isDemoMode,
} from "./demo-mode";

const APP_ROOT = "/srv/job-pilot/app";

function safeDemoEnvironment(overrides: Record<string, string> = {}) {
  return {
    JOB_PILOT_DEPLOYMENT_MODE: "demo",
    DATABASE_PATH: `${APP_ROOT}/var/demo/job-pilot.sqlite`,
    UPLOADS_ROOT: `${APP_ROOT}/var/demo/uploads`,
    BACKUPS_ROOT: `${APP_ROOT}/var/demo/backups`,
    DEMO_ACCOUNT_EMAIL: "demo@jobpilot.invalid.test",
    DEMO_ACCOUNT_PASSWORD: "synthetic-password",
    ...overrides,
  };
}

describe("demo deployment safety", () => {
  it("enables demo behaviour only for the explicit deployment mode", () => {
    expect(isDemoMode({ JOB_PILOT_DEPLOYMENT_MODE: "demo" })).toBe(true);
    expect(isDemoMode({ JOB_PILOT_DEPLOYMENT_MODE: "public" })).toBe(false);
    expect(isDemoMode({ JOB_PILOT_DEPLOYMENT_MODE: "production" })).toBe(false);
    expect(isDemoMode({})).toBe(false);
  });

  it("accepts an isolated synthetic-only configuration", () => {
    expect(
      assertDemoConfiguration(safeDemoEnvironment(), APP_ROOT),
    ).toMatchObject({
      databasePath: `${APP_ROOT}/var/demo/job-pilot.sqlite`,
      uploadsRoot: `${APP_ROOT}/var/demo/uploads`,
      backupsRoot: `${APP_ROOT}/var/demo/backups`,
      accountEmail: "demo@jobpilot.invalid.test",
    });
  });

  it.each([
    ["normal database", { DATABASE_PATH: `${APP_ROOT}/var/job-pilot.sqlite` }],
    ["uploads outside demo", { UPLOADS_ROOT: `${APP_ROOT}/var/uploads` }],
    ["backups outside demo", { BACKUPS_ROOT: `${APP_ROOT}/var/backups` }],
    ["real email", { DEMO_ACCOUNT_EMAIL: "demo@example.com" }],
    ["missing password", { DEMO_ACCOUNT_PASSWORD: "" }],
    ["mail transport", { SMTP_URL: "smtp://mail.invalid.test" }],
    ["gmail credentials", { GMAIL_CLIENT_ID: "configured" }],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      assertDemoConfiguration(safeDemoEnvironment(override), APP_ROOT),
    ).toThrow();
  });

  it("exports the literal signup closure message", () => {
    expect(DEMO_SIGNUP_CLOSED_MESSAGE).toBe(
      "Public account creation is closed for this demo.",
    );
  });
});

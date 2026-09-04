import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GMAIL_NOT_CONNECTED_TITLE,
  QUIET_HOURS_ACTIVE_LABEL,
  QUIET_HOURS_AWAKE_LABEL,
  QUIET_HOURS_HELP,
  SETTINGS_ERROR,
  SETTINGS_LOADING,
  TIMEZONE_HELP,
} from "../domain/settings";
import {
  AUTOMATION_RULES_HELP,
  AUTOMATION_RULES_TITLE,
} from "../domain/rules";
import {
  EXPORT_CONTACTS_CSV_LABEL,
  EXPORT_JSON_LABEL,
} from "../domain/export";
import { updateWorkspaceSettings } from "../server/repos/settings";
import {
  connectEmailAccount,
  setDefaultEmailAccount,
} from "../server/repos/email-accounts";
import { createTenantTestFixture } from "../test/tenant-fixture";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: undefined as unknown,
  pathname: "/settings",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => mocks.pathname,
}));
vi.mock("@/server/auth/current-session", () => ({
  requireTenant: async () => mocks.tenant,
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));

import SettingsPage from "./(app)/settings/page";
import SettingsError from "./(app)/settings/error";
import SettingsLoading from "./(app)/settings/loading";
import SettingsLayout from "./(app)/settings/layout";
import ImportPage from "./(app)/settings/import/page";

describe("settings screen", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    mocks.database = undefined;
    mocks.tenant = undefined;
    mocks.pathname = "/settings";
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
    return fixture;
  }

  it("shows the saved profile, zone and quiet hours of the signed-in workspace", async () => {
    const fixture = newFixture();
    updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
      displayName: "Yash Kumar Vaibhav",
      university: "IIIT Delhi",
      timezone: "Asia/Kolkata",
      quietStart: "23:30",
      quietEnd: "08:00",
    });

    const html = renderToStaticMarkup(await SettingsPage());

    expect(html).toContain("Yash Kumar Vaibhav");
    expect(html).toContain("IIIT Delhi");
    expect(html).toContain('value="Asia/Kolkata"');
    expect(html).toContain('value="23:30"');
    expect(html).toContain('value="08:00"');
    expect(html).toContain(TIMEZONE_HELP);
    expect(html).toContain(QUIET_HOURS_HELP);
    expect(html).toContain(AUTOMATION_RULES_TITLE);
    expect(html).toContain(AUTOMATION_RULES_HELP);
    expect(html).toContain("Account security");
    expect(html).toContain("tenant-a");
    expect(html).toContain("Authenticator not set up");
    expect(html).toContain("Set up authenticator");
    expect(html).toContain(
      "Password recovery and password changes are unavailable until you set up an authenticator.",
    );
    expect(html).toContain("No activity");
    // The saved zone, not the server zone, decides whether now is quiet.
    expect(html).toContain("in Asia/Kolkata,");
    expect(
      html.includes(QUIET_HOURS_ACTIVE_LABEL) ||
        html.includes(QUIET_HOURS_AWAKE_LABEL),
    ).toBe(true);
    // Rendering settings writes nothing.
    expect(fixture.rowCount("notification")).toBe(0);
  });

  it("never renders another workspace's profile", async () => {
    const fixture = newFixture();
    updateWorkspaceSettings(fixture.client.db, fixture.tenantB, {
      displayName: "Someone Else",
      university: "Another University",
      timezone: "America/New_York",
    });

    const html = renderToStaticMarkup(await SettingsPage());

    expect(html).toContain("Tenant A");
    expect(html).not.toContain("Someone Else");
    expect(html).not.toContain("Another University");
  });

  it("offers the saved zone and other IANA names as selectable options", async () => {
    newFixture();

    const html = renderToStaticMarkup(await SettingsPage());

    expect(html).toContain('value="Asia/Kolkata"');
    expect(html).toContain('value="America/New_York"');
    expect(html).toContain('list="');
  });

  it("keeps Gmail honest when OAuth configuration is missing and renders all six scoring weights", async () => {
    newFixture();

    const html = renderToStaticMarkup(await SettingsPage());

    expect(html).toContain(GMAIL_NOT_CONNECTED_TITLE);
    expect(html).toContain("Limited pilot");
    expect(html).toContain("Add Gmail account");
    expect(html).toContain("GOOGLE_CLIENT_ID");
    expect(html).toContain("GOOGLE_CLIENT_SECRET");
    expect(html).toContain("GOOGLE_REDIRECT_URI");
    expect(html).toContain("TOKEN_KEY");
    expect(html).toContain("Opportunity scoring");
    expect(html).toContain('name="score.targetCompany"');
    expect(html).toContain('name="score.newGradRole"');
    expect(html).toContain('name="score.preferredLocation"');
    expect(html).toContain('name="score.referralAvailable"');
    expect(html).toContain('name="score.postedWithin48Hours"');
    expect(html).toContain('name="score.experienceExceedsEligibility"');
    expect(html).toContain('value="-3"');
    expect(html).toContain("disabled");
    expect(html).not.toContain('href="/api/gmail');
  });

  it("offers Add Gmail account only when every OAuth secret is configured", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv(
      "GOOGLE_REDIRECT_URI",
      "https://jobpilot.invalid.test/api/gmail/callback",
    );
    vi.stubEnv("TOKEN_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    newFixture();

    const html = renderToStaticMarkup(await SettingsPage());

    expect(html).toContain("Limited pilot");
    expect(html).toContain("Add Gmail account");
    expect(html).toContain('href="/api/gmail/connect"');
    expect(html).not.toContain("OAuth configuration is missing:");
  });

  it("renders two Gmail identities as independent account cards", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv(
      "GOOGLE_REDIRECT_URI",
      "https://jobpilot.invalid.test/api/gmail/callback",
    );
    const tokenKey = Buffer.alloc(32, 2).toString("base64");
    vi.stubEnv("TOKEN_KEY", tokenKey);
    const fixture = newFixture();
    const first = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-personal",
        email: "personal@invalid.test",
        refreshToken: "refresh-personal",
        senderName: "Personal sender",
        signature: "Personal signature",
        dailyLimit: 35,
      },
      tokenKey,
    );
    const second = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-career",
        email: "career@invalid.test",
        refreshToken: "refresh-career",
        senderName: "Career sender",
        replyTo: "reply@invalid.test",
        dailyLimit: 20,
      },
      tokenKey,
    );
    setDefaultEmailAccount(fixture.client.db, fixture.tenantA, second.id);

    const html = renderToStaticMarkup(await SettingsPage());

    expect(html).toContain("personal@invalid.test");
    expect(html).toContain("career@invalid.test");
    expect(html).toContain("Personal sender");
    expect(html).toContain("Personal signature");
    expect(html).toContain("reply@invalid.test");
    expect(html).toContain("Connected");
    expect(html).toContain("Default sender");
    expect(html).toContain("Set as default");
    expect(html).toContain("Save account settings");
    expect(html).toContain("Disconnect");
    expect(html).toContain(
      `/api/gmail/connect?accountId=${encodeURIComponent(first.id)}`,
    );
    expect(html).not.toContain("refresh-personal");
    expect(html).not.toContain("google-personal");
  });

  it("offers Export JSON and Export contacts CSV as same-origin downloads", async () => {
    newFixture();

    const html = renderToStaticMarkup(await SettingsPage());

    expect(html).toContain(EXPORT_JSON_LABEL);
    expect(html).toContain(EXPORT_CONTACTS_CSV_LABEL);
    expect(html).toContain("Password hashes and account tokens are not included.");
    expect(html).toContain('href="/api/export?format=json&amp;set=all"');
    expect(html).toContain('href="/api/export?format=csv&amp;set=contacts"');
    expect(html).toContain('download="job-pilot.json"');
    expect(html).toContain('download="job-pilot-contacts.csv"');
  });

  it("designs its loading and error states", () => {
    expect(renderToStaticMarkup(<SettingsLoading />)).toContain(
      SETTINGS_LOADING,
    );
    expect(
      renderToStaticMarkup(<SettingsError reset={() => undefined} />),
    ).toContain(SETTINGS_ERROR);
  });

  it("keeps Import on its own settings route with Settings as the landing tab", () => {
    const nav = renderToStaticMarkup(
      SettingsLayout({ children: <p>body</p> }),
    );

    expect(nav).toContain('href="/settings"');
    expect(nav).toContain('href="/settings/import"');
    expect(nav).toContain('href="/settings/activity"');
    expect(nav).toContain('aria-current="page"');
  });

  it("still renders the CSV import screen at its own route", async () => {
    newFixture();
    mocks.pathname = "/settings/import";

    const html = renderToStaticMarkup(await ImportPage());
    expect(html).toContain("CSV import");
  });

  it("styles the settings surface for narrow viewports in tokens only", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

    expect(css).toContain(".settings-section");
    expect(css).toContain(".settings-export-actions");
    expect(css).toContain("min-height: var(--target-min)");
    expect(css).toContain("@media (max-width: 767px)");
    expect(/\.settings-[a-z-]*\s*\{[^}]*#[0-9a-fA-F]{3}/.test(css)).toBe(false);
  });
});

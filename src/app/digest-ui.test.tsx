import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calendarDateInZone } from "../domain/referral";
import {
  DIGEST_EMAIL_LABEL,
  DIGEST_PREVIEW_TITLE,
  formatDigestBody,
} from "../domain/digest";
import { createContact } from "../server/repos/contacts";
import { getTodaySnapshot } from "../server/repos/today";
import { createTenantTestFixture } from "../test/tenant-fixture";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: undefined as unknown,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/settings/digest/preview",
}));
vi.mock("@/server/auth/current-session", () => ({
  requireTenant: async () => mocks.tenant,
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));

import DigestPreviewPage from "./(app)/settings/digest/preview/page";

describe("morning digest preview screen", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  beforeEach(() => {
    mocks.database = undefined;
    mocks.tenant = undefined;
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
    return fixture;
  }

  it("shows Today counts for the signed-in workspace only", async () => {
    const fixture = newFixture();
    const now = new Date();
    const asOfOn = calendarDateInZone("Asia/Kolkata", now);
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul Sharma",
      followUpOn: asOfOn,
      now,
    });
    createContact(fixture.client.db, fixture.tenantB, {
      id: "other",
      name: "Someone Else",
      followUpOn: asOfOn,
      now,
    });

    const html = renderToStaticMarkup(await DigestPreviewPage());
    const today = getTodaySnapshot(fixture.client.db, fixture.tenantA, { now });
    expect(html).toContain(DIGEST_PREVIEW_TITLE);
    expect(html).toContain("1 follow-up due");
    expect(html).toContain(formatDigestBody({
      followUps: today.stats.followUps,
      deadlines: today.stats.deadlines,
      oa: today.pipeline.oa,
      replies: today.stats.needReply,
      interviewsToday: today.stats.interviewsToday,
    }));
    expect(html).not.toContain("Someone Else");
    expect(html).not.toContain(DIGEST_EMAIL_LABEL);
    expect(today.stats.followUps).toBe(1);
  });

  it("styles the preview as a hairline settings card without a resting shadow", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const section = css.slice(
      css.indexOf(".settings-section {"),
      css.indexOf(".settings-help,"),
    );
    const preview = css.slice(
      css.indexOf(".digest-preview-list"),
      css.indexOf(".digest-preview-body") + 280,
    );
    expect(section).toContain("1px solid var(--line)");
    expect(section).not.toContain("box-shadow");
    expect(preview).toContain("var(--line)");
    expect(preview).toContain("tabular-nums");
    expect(preview).not.toContain("box-shadow");
    expect(preview).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

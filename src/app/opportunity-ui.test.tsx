import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyToOpportunity, updateApplication } from "../server/repos/applications";
import { createCompany } from "../server/repos/companies";
import { createContact } from "../server/repos/contacts";
import { createInterview } from "../server/repos/interviews";
import { createAssessment } from "../server/repos/assessments";
import { createOpportunity, linkContactToOpportunity } from "../server/repos/opportunities";
import { createReferral } from "../server/repos/referrals";
import { updateWorkspaceSettings } from "../server/repos/settings";
import { createTenantTestFixture } from "../test/tenant-fixture";
import { calendarDateInZone, shiftCalendarDate } from "../domain/referral";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: undefined as unknown,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/server/auth/current-session", () => ({
  requireTenant: async () => mocks.tenant,
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));

import OpportunityDetailPage from "./(app)/opportunities/[id]/page";
import OpportunitiesPage from "./(app)/opportunities/page";

describe("opportunity screens", () => {
  const fixtures: { dispose: () => void }[] = [];

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
    return fixture;
  }

  beforeEach(() => {
    mocks.database = undefined;
    mocks.tenant = undefined;
  });

  it("names the empty state and requires a company in the add form", async () => {
    newFixture();
    const html = renderToStaticMarkup(
      await OpportunitiesPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("No opportunities. Paste a job URL or add one");
    expect(html).toContain("Add job");
    expect(html).toContain("Add a company before adding a job");
  });

  it("renders Saved, Active, and All filters plus desktop and mobile treatments", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "google",
      name: "Google",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-swe",
      companyId: company.id,
      role: "Software Engineer",
      jobId: "123456",
      bucket: "saved",
    });

    const html = renderToStaticMarkup(
      await OpportunitiesPage({
        searchParams: Promise.resolve({ bucket: "saved" }),
      }),
    );
    expect(html).toContain("Saved");
    expect(html).toContain("Active");
    expect(html).toContain("All");
    expect(html).toContain('class="tbl opportunity-table"');
    expect(html).toContain('class="opportunity-card-list"');
    expect(html).toContain("Software Engineer");
    expect(html).toContain("123456");
    expect(html).toContain('aria-hidden="true"');
  });

  it("applies URL-backed job filters and preserves them in bucket links", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "google",
      name: "Google",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "ms-sde",
      companyId: "microsoft",
      role: "SDE",
      priority: "High",
      deadlineOn: "2026-09-03",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-swe",
      companyId: "google",
      role: "Software Engineer",
      priority: "Medium",
      deadlineOn: "2026-09-20",
    });

    const html = renderToStaticMarkup(
      await OpportunitiesPage({
        searchParams: Promise.resolve({
          bucket: "all",
          company: "microsoft",
          priority: "High",
        }),
      }),
    );
    for (const expected of [
      'name="company"',
      'name="priority"',
      'name="deadlineWithinDays"',
      'name="appliedWithinDays"',
      'name="sort"',
      "Priority score",
      "Apply filters",
      "Clear filters",
      "SDE",
    ]) {
      expect(html).toContain(expected);
    }
    expect(html).not.toContain("Software Engineer");
    expect(html).toContain("company=microsoft");
    expect(html).toContain("priority=High");

    const empty = renderToStaticMarkup(
      await OpportunitiesPage({
        searchParams: Promise.resolve({ priority: "Missing" }),
      }),
    );
    expect(empty).toContain("No opportunities match these filters.");
  });

  it("sorts the list by its numeric score without using score colour", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "target",
      name: "Zeta Target",
      target: true,
    });
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "random",
      name: "Alpha Random",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "target-role",
      companyId: "target",
      role: "New Grad Engineer",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "random-role",
      companyId: "random",
      role: "Software Engineer",
    });

    const html = renderToStaticMarkup(
      await OpportunitiesPage({
        searchParams: Promise.resolve({ sort: "score" }),
      }),
    );
    expect(html.indexOf("New Grad Engineer")).toBeLessThan(
      html.indexOf("Software Engineer"),
    );
    expect(html).toContain('class="tnum">6</td>');
    expect(html).not.toContain("score--success");
    expect(html).not.toContain("score--warning");
    expect(html).not.toContain("score--danger");
  });

  it("shows the section 59 action-required banner with icon and reasons", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "target",
      name: "Target Company",
      target: true,
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "referrer",
      companyId: "target",
      name: "Synthetic Referrer",
    });
    const asOfOn = calendarDateInZone("Asia/Kolkata");
    const deadlineOn = shiftCalendarDate(asOfOn, 2);
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "deadline-role",
      companyId: "target",
      role: "New Grad Engineer",
      deadlineOn,
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      id: "received-referral",
      contactId: "referrer",
      opportunityId: "deadline-role",
      channel: "email",
      stage: "referral_received",
      todayOn: asOfOn,
    });

    const html = renderToStaticMarkup(
      await OpportunityDetailPage({
        params: Promise.resolve({ id: "deadline-role" }),
      }),
    );
    expect(html).toContain("Action required");
    expect(html).toContain(`Apply before ${deadlineOn}.`);
    expect(html).toContain("Deadline is in 2 days.");
    expect(html).toContain("Referral received.");
    expect(html).toContain("Application not submitted.");
    expect(html).toContain('class="opportunity-health"');
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("shows the numeric score, fired terms, and a saved weight change", async () => {
    const fixture = newFixture();
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "target",
      name: "Target Company",
      target: true,
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "scored-role",
      companyId: "target",
      role: "New Grad Engineer",
    });

    const before = renderToStaticMarkup(
      await OpportunityDetailPage({
        params: Promise.resolve({ id: "scored-role" }),
      }),
    );
    expect(before).toContain("Priority score");
    expect(before).toContain('aria-label="Priority score terms"');
    expect(before).toContain('class="tnum opportunity-score__total">6</strong>');
    expect(before).toContain("Target company");
    expect(before).toContain("New-grad role");
    expect(before).toContain("+3");

    updateWorkspaceSettings(fixture.client.db, fixture.tenantA, {
      displayName: "Tenant A",
      scoringWeights: { targetCompany: 0 },
    });
    const after = renderToStaticMarkup(
      await OpportunityDetailPage({
        params: Promise.resolve({ id: "scored-role" }),
      }),
    );
    expect(after).toContain('class="tnum opportunity-score__total">3</strong>');
    expect(after).toContain("Target company");
    expect(after).toContain('class="tnum">0</span>');
  });

  it("renders persisted detail fields and only pursuit stages in the edit form", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "google",
      name: "Google",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-swe",
      companyId: company.id,
      role: "Software Engineer",
      compensation: "INR 24 LPA",
      interestScore: 9,
      referralPreferred: true,
      jdSnapshot: "Build reliable distributed systems.",
      stage: "interested",
    });

    const html = renderToStaticMarkup(
      await OpportunityDetailPage({
        params: Promise.resolve({ id: "google-swe" }),
      }),
    );
    for (const expected of [
      "Google",
      "Software Engineer",
      "INR 24 LPA",
      "9",
      "Referral preferred",
      "Build reliable distributed systems.",
      "Interested",
      "Ready to Apply",
      "No Longer Interested",
    ]) {
      expect(html).toContain(expected);
    }
    expect(html).not.toContain("OA Received");
    expect(html).not.toContain("Interview Scheduled");
    expect(html).not.toContain("Offer</option>");
    expect(html).toContain("Linked contacts");
    expect(html).toContain("No contacts linked to this opening yet.");
    expect(html).toContain("Every contact is already linked, or none exist yet.");
    expect(html).toContain("Mark applied");
    expect(html).toContain("Interviews");
    expect(html).toContain("No interview rounds yet. Add the first one below.");
    expect(html).toContain("Add interview");
    expect(html).toContain("Pursuit stage");
    expect(html).toContain('id="application"');
    expect(html).toContain("Referral requests");
    expect(html).toContain("No referral requests for this opening yet.");
    expect(html).toContain("Add a contact before asking for a referral.");
  });

  it("lists a linked contact and the remaining picker on opportunity detail", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "google",
      name: "Google",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      companyId: company.id,
      name: "Rahul Sharma",
    });
    createContact(fixture.client.db, fixture.tenantA, {
      id: "priya",
      name: "Priya Nair",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-swe",
      companyId: company.id,
      role: "Software Engineer",
    });
    linkContactToOpportunity(
      fixture.client.db,
      fixture.tenantA,
      "google-swe",
      "rahul",
    );

    const html = renderToStaticMarkup(
      await OpportunityDetailPage({
        params: Promise.resolve({ id: "google-swe" }),
      }),
    );

    expect(html).toContain("Linked contacts");
    expect(html).toContain("Rahul Sharma");
    expect(html).toContain('href="/contacts/rahul"');
    expect(html).toContain("contact-table");
    expect(html).toContain("contact-card-list");
    expect(html).toContain("Link contact");
    expect(html).toContain("Priya Nair");
    expect(html).not.toContain("No contacts linked to this opening yet.");
  });

  it("uses the same not-found state for missing and foreign ids", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantB, {
      id: "company-b",
      name: "Private Company",
    });
    createOpportunity(fixture.client.db, fixture.tenantB, {
      id: "opportunity-b",
      companyId: company.id,
      role: "Private Role",
    });

    for (const id of ["missing", "opportunity-b"]) {
      const html = renderToStaticMarkup(
        await OpportunityDetailPage({ params: Promise.resolve({ id }) }),
      );
      expect(html).toContain("Opportunity not found");
      expect(html).not.toContain("Private Role");
    }
  });

  it("rolls the header chip up to the application stage after apply", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "google",
      name: "Google",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-swe",
      companyId: company.id,
      role: "Software Engineer",
    });
    const created = applyToOpportunity(fixture.client.db, fixture.tenantA, {
      opportunityId: "google-swe",
      portal: "Greenhouse",
      appliedOn: "2026-09-01",
    });
    updateApplication(fixture.client.db, fixture.tenantA, created!.id, {
      stage: "under_review",
    });

    const html = renderToStaticMarkup(
      await OpportunityDetailPage({
        params: Promise.resolve({ id: "google-swe" }),
      }),
    );

    expect(html).toContain("Under Review");
    expect(html).toContain("Application stage");
    expect(html).toContain("Greenhouse");
    expect(html).toContain("Save application");
    expect(html).toContain("Offer deadline");
    expect(html).toContain("Offer decision");
    expect(html).not.toContain("Mark applied");
  });

  it("lists ordered interview rounds as a table and stacked cards", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "ms-sde",
      companyId: company.id,
      role: "SDE",
    });
    createInterview(fixture.client.db, fixture.tenantA, {
      id: "round-1",
      opportunityId: "ms-sde",
      kind: "Coding",
      interviewer: "Rahul",
      dateOn: "2026-09-02",
      time: "11:00",
    });

    const html = renderToStaticMarkup(
      await OpportunityDetailPage({
        params: Promise.resolve({ id: "ms-sde" }),
      }),
    );
    expect(html).toContain("Interviews");
    expect(html).toContain('class="tbl interview-table"');
    expect(html).toContain('class="interview-card-list"');
    expect(html).toContain("Coding");
    expect(html).toContain("Rahul");
    expect(html).toContain("Add interview");
    expect(html).toContain("Save round");
    expect(html).toContain("Delete round");
    expect(html).toContain("11:00");
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain(".interview-table-wrap");
    expect(css).toContain(".interview-card-list");
    expect(css).toContain("@media (max-width: 767px)");
  });

  it("lists assessments with the round list and keeps the rolled-up chip on application.stage", async () => {
    const fixture = newFixture();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      id: "google",
      name: "Google",
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "google-swe",
      companyId: company.id,
      role: "SDE",
    });
    createAssessment(fixture.client.db, fixture.tenantA, {
      id: "oa-google",
      opportunityId: "google-swe",
      kind: "Online Assessment",
      platform: "HackerRank",
      dateOn: "2026-09-03",
      time: "18:00",
    });

    const html = renderToStaticMarkup(
      await OpportunityDetailPage({
        params: Promise.resolve({ id: "google-swe" }),
      }),
    );
    expect(html).toContain("Assessments");
    expect(html).toContain('class="tbl assessment-table"');
    expect(html).toContain('class="assessment-card-list"');
    expect(html).toContain("Online Assessment");
    expect(html).toContain("HackerRank");
    expect(html).toContain("Add assessment");
    expect(html).toContain("Save assessment");
    expect(html).toContain("Invited");
    expect(html).toContain("Mark applied");
    expect(html).toContain("Pursuit stage");
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain(".assessment-table-wrap");
    expect(css).toContain(".assessment-card-list");
  });

  it("names why an opportunity is stale", async () => {
    const fixture = newFixture();
    const createdAt = new Date("2026-08-26T04:30:00.000Z");
    createCompany(fixture.client.db, fixture.tenantA, {
      id: "microsoft",
      name: "Microsoft",
      now: createdAt,
    });
    createOpportunity(fixture.client.db, fixture.tenantA, {
      id: "silent",
      companyId: "microsoft",
      role: "SDE",
      bucket: "active",
      deadlineOn: "2026-09-04",
      now: createdAt,
    });

    const html = renderToStaticMarkup(
      await OpportunityDetailPage({
        params: Promise.resolve({ id: "silent" }),
      }),
    );
    expect(html).toContain("Stale");
    expect(html).toContain("No activity for");
    expect(html).toContain("Job deadline 2026-09-04");
    expect(html).toContain("aria-hidden=\"true\"");
  });
});

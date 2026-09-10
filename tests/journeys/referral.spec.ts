import { expect, test } from "@playwright/test";

import {
  JOURNEY_ACCOUNTS,
  openCreateForm,
  openRecordDetail,
  saveAndSettle,
  signIn,
  workspaceDate,
} from "./fixture";

/**
 * Referrals are where the CRM stops being a list and starts doing work. Two
 * deterministic rules fire here (D-014): asking schedules the chase, and a
 * referral arriving moves the role to Ready to Apply. Both are asserted through
 * the screens, because a rule that fires in the repository and never reaches
 * the user is indistinguishable from one that does not fire at all.
 */
test.describe.configure({ mode: "serial" });

const COMPANY = "Northwind Analytics";
const CONTACT = "Vikram Shetty";
const ROLE = "Data Platform Engineer";

test.beforeEach(async ({ page }) => {
  await signIn(page, JOURNEY_ACCOUNTS.referral);
});

test("a company, a contact inside it, and the role being chased", async ({
  page,
}) => {
  await page.goto("/companies");
  const companyForm = await openCreateForm(
    page,
    "Add company",
    "new-company-form",
    "Company name",
  );
  await companyForm.getByLabel("Company name", { exact: true }).fill(COMPANY);
  await companyForm.getByRole("button", { name: "Save company" }).click();
  await expect(page.getByRole("heading", { level: 1, name: COMPANY })).toBeVisible();

  await page.goto("/contacts");
  const contactForm = await openCreateForm(
    page,
    "Add contact",
    "new-contact-form",
    "Name",
  );
  await contactForm.getByLabel("Name", { exact: true }).fill(CONTACT);
  await contactForm.getByLabel("Company", { exact: true }).fill(COMPANY);
  await contactForm.getByLabel("Relationship", { exact: true }).selectOption("employee");
  await contactForm.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByRole("heading", { level: 1, name: CONTACT })).toBeVisible();

  await page.goto("/opportunities");
  const jobForm = await openCreateForm(
    page,
    "Add job",
    "new-opportunity-form",
    "Role",
  );
  await jobForm.getByLabel("Company", { exact: true }).selectOption({ label: COMPANY });
  await jobForm.getByLabel("Role", { exact: true }).fill(ROLE);
  await jobForm.getByRole("button", { name: "Save job" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(ROLE, "i") }),
  ).toBeVisible();
});

test("asking for a referral schedules the chase without being asked twice", async ({
  page,
}) => {
  const requestedOn = workspaceDate();
  await page.goto("/opportunities");
  page = await openRecordDetail(page, page.getByRole("link", { name: new RegExp(ROLE, "i") }));

  const referrals = page.getByRole("region", { name: "Referral requests" });
  await referrals.getByLabel("Contact", { exact: true }).selectOption({ label: CONTACT });
  await referrals.getByLabel("Stage", { exact: true }).selectOption("requested");
  await referrals.getByLabel("Channel", { exact: true }).selectOption("linkedin_dm");
  await referrals.getByLabel("Date requested", { exact: true }).fill(requestedOn);
  await saveAndSettle(
    page,
    referrals.getByRole("button", { name: "Add referral" }),
    "/api/referrals",
  );

  await page.goto("/referrals");
  const row = page.getByRole("row").filter({ hasText: CONTACT });
  await expect(row).toBeVisible();
  await expect(row.getByText("Requested")).toBeVisible();

  // The rule engine, seen from the user's chair: nobody typed this task, and it
  // is dated four days out rather than today, so the chase is scheduled rather
  // than nagging immediately.
  await page.goto("/tasks");
  await expect(page.getByText("Follow up on referral").first()).toBeVisible();
  await expect(page.getByText(workspaceDate(4)).first()).toBeVisible();
});

test("a referral arriving moves the role to Ready to Apply on its own", async ({
  page,
}) => {
  await page.goto("/referrals");
  // Open the request from its own row rather than by a name pattern: the page
  // also carries preset links, and matching one of those would leave the test
  // filling the filter form instead of the referral.
  page = await openRecordDetail(page, page.getByRole("row").filter({ hasText: CONTACT }).getByRole("link").first());

  const detail = page.getByRole("region", { name: "Edit referral" });
  await detail.getByLabel("Stage", { exact: true }).selectOption("referral_received");
  await saveAndSettle(
    page,
    detail.getByRole("button", { name: /^Save/ }),
    "/api/referrals/",
  );

  await page.goto("/opportunities");
  page = await openRecordDetail(page, page.getByRole("link", { name: new RegExp(ROLE, "i") }));

  await expect(
    page
      .getByRole("region", { name: "Edit opportunity" })
      .getByLabel("Pursuit stage", { exact: true }),
  ).toHaveValue("ready_to_apply");
});

test("the funnel separates a referred application from a cold one", async ({
  page,
}) => {
  await page.goto("/opportunities");
  page = await openRecordDetail(page, page.getByRole("link", { name: new RegExp(ROLE, "i") }));

  await page.getByLabel("Portal", { exact: true }).fill("Referral portal");
  await page.getByLabel("Applied date", { exact: true }).fill(workspaceDate());
  await page.getByLabel("Referrer", { exact: true }).fill(CONTACT);
  await page.getByRole("button", { name: "Mark applied" }).click();
  await expect(page.getByRole("button", { name: "Save application" })).toBeVisible();

  await page.goto("/analytics");
  const funnel = page.getByRole("region", { name: "Funnel" });
  await expect(
    funnel.getByRole("listitem").filter({ hasText: "Referral attempts" }),
  ).toContainText("1");
  await expect(
    funnel.getByRole("listitem").filter({ hasText: "Referrals obtained" }),
  ).toContainText("1");
});

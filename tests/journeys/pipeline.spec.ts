import { expect, test, type Page } from "@playwright/test";

import {
  JOURNEY_ACCOUNTS,
  openCreateForm,
  signIn,
  workspaceDate,
} from "./fixture";

/**
 * The spine of the product: a role post goes from "I saw this on a careers
 * page" to a submitted application, and the counts a user steers by move with
 * it. Each step is the screen a person would actually be on, so a regression
 * anywhere in that chain fails here rather than in a repository test that
 * cannot see the wiring.
 */
test.describe.configure({ mode: "serial" });

const COMPANY = "Meridian Robotics";
const ROLE = "Backend Engineer, New Grad";

test.beforeEach(async ({ page }) => {
  await signIn(page, JOURNEY_ACCOUNTS.pipeline);
});

async function pipelineCount(page: Page, label: string): Promise<number> {
  const tile = page
    .locator(".stat-tile, [data-stat], li, div")
    .filter({ hasText: new RegExp(`^\\s*${label}\\s*\\d+\\s*$`, "i") })
    .first();
  const text = (await tile.textContent()) ?? "";
  return Number(text.replace(/\D+/g, ""));
}

test("a job cannot be added before the company that posted it exists", async ({
  page,
}) => {
  await page.goto("/opportunities");

  // The guidance has to say what to do next, not just refuse. An empty product
  // that only disables its primary control is where new users stall.
  await expect(
    page.getByText("Add a company before adding a job."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add job", exact: true })).toBeDisabled();
});

test("tracking a company makes it the anchor for its roles", async ({ page }) => {
  await page.goto("/companies");
  const form = await openCreateForm(page, "Add company", "new-company-form", "Company name");

  await form.getByLabel("Company name", { exact: true }).fill(COMPANY);
  await form.getByLabel("Industry", { exact: true }).fill("Robotics");
  await form.getByLabel("Locations", { exact: true }).fill("Bengaluru");
  await form.getByLabel("Mark as a target company").check();
  await form.getByRole("button", { name: "Save company" }).click();

  // Saving lands on the new record rather than back on the list, which is the
  // behaviour worth pinning: the user's next move is almost always on the
  // company they just created.
  await expect(page.getByRole("heading", { level: 1, name: COMPANY })).toBeVisible();
  await expect(page.getByText("Robotics", { exact: true })).toBeVisible();

  await page.goto("/companies");
  await expect(page.getByRole("link", { name: COMPANY })).toBeVisible();

  // Adding the company is what unlocks the job form; assert the release, not
  // just the row, because that coupling is the thing a user feels.
  await page.goto("/opportunities");
  await expect(
    page.getByRole("button", { name: "Add job", exact: true }),
  ).toBeEnabled();
});

test("a saved role post appears in the pipeline with its deadline", async ({
  page,
}) => {
  const deadline = workspaceDate(6);
  await page.goto("/opportunities");
  const form = await openCreateForm(page, "Add job", "new-opportunity-form", "Role");

  await form.getByLabel("Company", { exact: true }).selectOption({ label: COMPANY });
  await form.getByLabel("Role", { exact: true }).fill(ROLE);
  await form.getByLabel("Location", { exact: true }).fill("Bengaluru");
  await form.getByLabel("Deadline", { exact: true }).fill(deadline);
  await form.getByLabel("Priority", { exact: true }).fill("High");
  await form.getByRole("button", { name: "Save job" }).click();

  await expect(page.getByRole("heading", { level: 1, name: new RegExp(ROLE, "i") })).toBeVisible();

  await page.goto("/opportunities");
  await expect(page.getByRole("link", { name: new RegExp(ROLE, "i") })).toBeVisible();
  await expect(page.getByText(deadline).first()).toBeVisible();
});

test("the pipeline board counts the role the moment it is saved", async ({
  page,
}) => {
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();
  expect(await pipelineCount(page, "Saved")).toBeGreaterThanOrEqual(1);
});

test("applying to a role records the application and moves the count", async ({
  page,
}) => {
  await page.goto("/opportunities");
  await page.getByRole("link", { name: new RegExp(ROLE, "i") }).click();
  await expect(page.getByRole("heading", { name: "Application" })).toBeVisible();

  await page.getByLabel("Portal", { exact: true }).fill("Careers site");
  await page.getByLabel("Applied date", { exact: true }).fill(workspaceDate());
  await page.getByRole("button", { name: "Mark applied" }).click();

  // The apply form is replaced by the editing surface once the application
  // exists. Waiting for that swap rather than navigating straight to the list
  // is what a person does anyway, and it stops the test from racing its own
  // POST — navigating away mid-request aborts it and the row never lands.
  await expect(
    page.getByRole("button", { name: "Save application" }),
  ).toBeVisible();

  await page.goto("/applications");
  await expect(page.getByText(new RegExp(ROLE, "i")).first()).toBeVisible();

  await page.goto("/today");
  expect(await pipelineCount(page, "Applied")).toBeGreaterThanOrEqual(1);
});

test("the funnel counts the work just done, and withholds rates it cannot support", async ({
  page,
}) => {
  await page.goto("/analytics");
  const funnel = page.getByRole("region", { name: "Funnel" });

  // One role pursued, one application: the numbers are the ones this file
  // created, not a fixture, which is the whole point of reading them here.
  await expect(
    funnel.getByRole("listitem").filter({ hasText: "Opportunities pursued" }),
  ).toContainText("1");
  await expect(
    funnel.getByRole("listitem").filter({ hasText: "Applications" }),
  ).toContainText("1");

  // A single application must never be rendered as a rate. The product's own
  // promise is that percentages wait for five outcomes, and a small-n guard is
  // exactly the kind of honesty that quietly rots.
  await expect(funnel.getByText("n < 5 — not enough data").first()).toBeVisible();
  await expect(funnel.getByText("%")).toHaveCount(0);

  // Applying without a referral has to land on the cold side of the split.
  const split = page.getByRole("region", { name: "Referral vs cold" });
  await expect(
    split.getByRole("article").filter({ hasText: "Cold applications" }),
  ).toContainText("1 applications");
  await expect(
    split.getByRole("article").filter({ hasText: "Referral applications" }),
  ).toContainText("0 applications");
});

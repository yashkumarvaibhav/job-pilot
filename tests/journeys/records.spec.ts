import { expect, test } from "@playwright/test";

import {
  JOURNEY_ACCOUNTS,
  openCreateForm,
  saveAndSettle,
  signIn,
  workspaceDate,
} from "./fixture";

/**
 * The paperwork around a search: which resume went out with which application,
 * finding a record again once there are too many to scroll, and getting the
 * whole workspace back out. These are the parts a user only notices when they
 * fail, and they fail quietly.
 */
test.describe.configure({ mode: "serial" });

const COMPANY = "Kestrel Foods";
const ROLE = "Platform Engineer";
const RESUME = "Backend resume";

test.beforeEach(async ({ page }) => {
  await signIn(page, JOURNEY_ACCOUNTS.records);
});

test("a resume is created first, then given a version to upload against", async ({
  page,
}) => {
  await page.goto("/settings/documents");

  // The document is the identity ("Backend resume"); versions hang off it. That
  // split is what lets an application point at the exact file that was sent
  // rather than at whatever the current resume happens to be.
  await page.getByLabel("Document name", { exact: true }).fill(RESUME);
  await page.getByLabel("Type", { exact: true }).selectOption("resume");
  await saveAndSettle(
    page,
    page.getByRole("button", { name: "Add document" }),
    "/api/documents",
  );
  await expect(page.getByText(RESUME).first()).toBeVisible();

  await page.getByLabel("Version label", { exact: true }).fill("v1");
  await page.getByLabel("File", { exact: true }).setInputFiles({
    name: "backend-resume.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 synthetic journey resume"),
  });
  await saveAndSettle(
    page,
    page.getByRole("button", { name: /version/i }),
    "/versions",
  );

  await expect(page.getByText("v1").first()).toBeVisible();
});

test("an application records which resume version was sent", async ({ page }) => {
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

  await page.goto("/opportunities");
  const jobForm = await openCreateForm(page, "Add job", "new-opportunity-form", "Role");
  await jobForm.getByLabel("Company", { exact: true }).selectOption({ label: COMPANY });
  await jobForm.getByLabel("Role", { exact: true }).fill(ROLE);
  await jobForm.getByRole("button", { name: "Save job" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(ROLE, "i") }),
  ).toBeVisible();

  await page.getByLabel("Portal", { exact: true }).fill("Careers site");
  await page.getByLabel("Applied date", { exact: true }).fill(workspaceDate());
  await page
    .getByLabel("Resume version used", { exact: true })
    .selectOption({ index: 1 });
  await page.getByRole("button", { name: "Mark applied" }).click();

  // Months later, "which resume did I send them" is the question this answers.
  await expect(page.getByRole("button", { name: "Save application" })).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel("Resume version used", { exact: true }),
  ).not.toHaveValue("");
});

test("the command palette finds a record without knowing its URL", async ({
  page,
}) => {
  await page.goto("/today");
  await page.getByRole("button", { name: "Open command palette" }).click();

  const palette = page.getByRole("dialog");
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox").or(palette.getByRole("textbox")).first().fill("Kestrel");

  await expect(palette.getByText(COMPANY).first()).toBeVisible({ timeout: 15_000 });
});

test("the palette closes on Escape and returns the keyboard", async ({ page }) => {
  await page.goto("/today");
  await page.getByRole("button", { name: "Open command palette" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open command palette" }),
  ).toBeFocused();
});

test("the workspace can be exported rather than held hostage", async ({ page }) => {
  await page.goto("/settings");
  // The links the settings screen actually offers, not an invented endpoint.
  const full = await page.request.get("/api/export?format=json&set=all");
  expect(full.status()).toBe(200);
  const body = await full.text();
  // An export is only worth having if it carries the work, not just a shell.
  expect(body).toContain(COMPANY);
  expect(body).toContain(ROLE);

  const jobsCsv = await page.request.get("/api/export?format=csv&set=jobs");
  expect(jobsCsv.status()).toBe(200);
  expect(await jobsCsv.text()).toContain(ROLE);
});

test("an export with no set named is refused rather than guessed at", async ({
  page,
}) => {
  const response = await page.request.get("/api/export", {
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(400);
});

test("one workspace's export never carries another's rows", async ({ page }) => {
  await signIn(page, JOURNEY_ACCOUNTS.neighbour);
  const response = await page.request.get("/api/export?format=json&set=all");

  expect(response.status()).toBe(200);
  expect(await response.text()).not.toContain(COMPANY);
});

import { expect, test, type Page } from "@playwright/test";

import { generateTotpCode } from "../../src/server/auth/totp";
import { ACCOUNT_PASSWORD, BASE_URL } from "./fixture";

/**
 * The first five minutes, driven for real: a stranger creates an account,
 * connects an authenticator because D-052 makes that the only recovery path,
 * and arrives in an empty workspace. Everything else in this suite starts from
 * a seeded account, so this is the only place the front door is exercised.
 */
test.describe.configure({ mode: "serial" });

const USERNAME = `journey_newcomer_${Date.now().toString(36)}`;
let totpSecret = "";

/**
 * One context for the whole file. Playwright hands each test a fresh one, which
 * would drop the half-finished signup session between steps — and that session
 * surviving is exactly what the enrollment gate below is about.
 */
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});

test("signup refuses a password the account could not defend", async () => {
  await page.goto("/?auth=sign-up");
  const dialog = page.getByRole("dialog");

  await dialog.getByLabel("Username", { exact: true }).fill(USERNAME);
  await dialog.getByLabel("Password", { exact: true }).fill("short");
  await dialog.getByLabel("Confirm password", { exact: true }).fill("short");
  await dialog.getByRole("button", { name: "Continue to authenticator" }).click();

  await expect(dialog.getByRole("alert")).toBeVisible();
  // The password must not be written back into the DOM after a rejection.
  await expect(dialog.getByLabel("Password", { exact: true })).toHaveValue("");
});

test("signup refuses two passwords that do not match", async () => {
  await page.goto("/?auth=sign-up");
  const dialog = page.getByRole("dialog");

  await dialog.getByLabel("Username", { exact: true }).fill(USERNAME);
  await dialog.getByLabel("Password", { exact: true }).fill(ACCOUNT_PASSWORD);
  await dialog
    .getByLabel("Confirm password", { exact: true })
    .fill(`${ACCOUNT_PASSWORD}-typo`);
  await dialog.getByRole("button", { name: "Continue to authenticator" }).click();

  await expect(dialog.getByRole("alert")).toContainText(/do not match/i);
});

test("a new account is taken to authenticator setup, not into the product", async () => {
  await page.goto("/?auth=sign-up");
  const dialog = page.getByRole("dialog");

  await dialog.getByLabel("Username", { exact: true }).fill(USERNAME);
  await dialog.getByLabel("Password", { exact: true }).fill(ACCOUNT_PASSWORD);
  await dialog.getByLabel("Confirm password", { exact: true }).fill(ACCOUNT_PASSWORD);
  await dialog.getByRole("button", { name: "Continue to authenticator" }).click();

  // Regex, not a glob: "?" is a single-character wildcard in glob patterns and
  // would never match the literal query string.
  await page.waitForURL(/\?auth=setup-totp/);
  await expect(page.getByRole("dialog")).toBeVisible();

  // Anyone setting this up on the same device they are reading it on takes the
  // manual key rather than the QR code, so open that disclosure the way they
  // would; the secret is deliberately not rendered until it is asked for.
  await page.locator("details.totp-manual summary").click();
  totpSecret = (await page.locator(".totp-secret").innerText()).trim();
  expect(totpSecret).toMatch(/^[A-Z2-7]{16,}$/);
});

test("the half-finished account cannot wander into the workspace", async () => {
  // Enrollment is not completion. Until the authenticator is confirmed there is
  // no recovery path, so the product must not hand over a workspace yet.
  await page.goto("/today");
  await expect(page).toHaveURL(/auth=setup-totp/);
});

test("confirming the authenticator opens the workspace", async () => {
  await page.goto("/?auth=setup-totp");
  const dialog = page.getByRole("dialog");

  await dialog
    .getByLabel("Six-digit code", { exact: true })
    .fill(generateTotpCode(totpSecret));
  await dialog.getByRole("button", { name: "Enable authenticator" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Do Now" }).getByText(/nothing due today/i),
  ).toBeVisible();
});

test("a wrong six-digit code is rejected rather than waved through", async () => {
  const response = await page.request.post(`${BASE_URL}/api/auth/login`, {
    data: { username: USERNAME, password: ACCOUNT_PASSWORD },
    headers: { Origin: BASE_URL },
  });
  expect(response.status()).toBe(200);

  const reset = await page.request.post(`${BASE_URL}/api/auth/recovery/reset`, {
    data: { username: USERNAME, code: "000000", password: "a-brand-new-password" },
    headers: { Origin: BASE_URL },
    failOnStatusCode: false,
  });
  expect(reset.status()).toBeGreaterThanOrEqual(400);
});

test("the authenticator is what recovers a forgotten password", async () => {
  const newPassword = "recovered-synthetic-password";
  const reset = await page.request.post(`${BASE_URL}/api/auth/recovery/reset`, {
    data: {
      username: USERNAME,
      code: generateTotpCode(totpSecret),
      password: newPassword,
    },
    headers: { Origin: BASE_URL },
    failOnStatusCode: false,
  });
  expect(reset.ok(), await reset.text()).toBe(true);

  // The old password must stop working the moment the new one is set.
  const stale = await page.request.post(`${BASE_URL}/api/auth/login`, {
    data: { username: USERNAME, password: ACCOUNT_PASSWORD },
    headers: { Origin: BASE_URL },
    failOnStatusCode: false,
  });
  expect(stale.status()).toBeGreaterThanOrEqual(400);

  const fresh = await page.request.post(`${BASE_URL}/api/auth/login`, {
    data: { username: USERNAME, password: newPassword },
    headers: { Origin: BASE_URL },
    failOnStatusCode: false,
  });
  expect(fresh.status()).toBe(200);
});

test("a signed-out visitor is sent to the door, not to a workspace", async () => {
  await page.context().clearCookies();
  for (const path of ["/today", "/contacts", "/settings"]) {
    await page.goto(path);
    expect(new URL(page.url()).pathname, path).toBe("/");
  }
});

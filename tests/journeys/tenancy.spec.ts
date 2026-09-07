import { expect, test } from "@playwright/test";

import {
  ACCOUNT_PASSWORD,
  BASE_URL,
  JOURNEY_ACCOUNTS,
  openCreateForm,
  signIn,
} from "./fixture";

/**
 * D-035's invariant, exercised the way it would actually be broken: not by an
 * attacker, but by a signed-in neighbour following a link. A cross-workspace id
 * must behave as not found — not as forbidden, which still confirms the row
 * exists — and must write no event in the victim's workspace.
 *
 * Repository tests already cover the query scoping. What they cannot cover is
 * whether every page and route actually goes through it, which is the failure
 * that would matter.
 */
test.describe.configure({ mode: "serial" });

const SECRET_COMPANY = "Blackwater Capital";
let companyId = "";

test("the owner records something private", async ({ page }) => {
  await signIn(page, JOURNEY_ACCOUNTS.security);
  await page.goto("/companies");
  const form = await openCreateForm(
    page,
    "Add company",
    "new-company-form",
    "Company name",
  );
  await form.getByLabel("Company name", { exact: true }).fill(SECRET_COMPANY);
  await form.getByLabel("Notes", { exact: true }).fill("Warm intro via a cousin.");
  await form.getByRole("button", { name: "Save company" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: SECRET_COMPANY }),
  ).toBeVisible();
  companyId = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(companyId).not.toBe("");
});

test("a neighbour opening that id by hand is told it does not exist", async ({
  page,
}) => {
  await signIn(page, JOURNEY_ACCOUNTS.neighbour);
  await page.goto(`/companies/${companyId}`);

  await expect(page.getByRole("heading", { name: "Company not found" })).toBeVisible();
  // The name must not leak through a heading, a breadcrumb or an error string.
  await expect(page.getByText(SECRET_COMPANY)).toHaveCount(0);
  await expect(page.getByText("Warm intro via a cousin.")).toHaveCount(0);
});

test("the neighbour's own lists stay empty rather than partly filled", async ({
  page,
}) => {
  await signIn(page, JOURNEY_ACCOUNTS.neighbour);
  for (const path of ["/companies", "/contacts", "/opportunities", "/referrals"]) {
    await page.goto(path);
    await expect(page.getByText(SECRET_COMPANY)).toHaveCount(0);
  }
});

test("the API refuses the same id, not just the page", async ({ page }) => {
  await signIn(page, JOURNEY_ACCOUNTS.neighbour);
  const response = await page.request.get(`${BASE_URL}/api/companies/${companyId}`);

  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain(SECRET_COMPANY);
});

test("global search cannot be used to fish across workspaces", async ({ page }) => {
  await signIn(page, JOURNEY_ACCOUNTS.neighbour);
  const response = await page.request.get(
    `${BASE_URL}/api/palette?q=${encodeURIComponent("Blackwater")}`,
  );

  expect(response.status()).toBe(200);
  expect(await response.text()).not.toContain(SECRET_COMPANY);
});

test("signing out closes the workspace behind you", async ({ page }) => {
  await signIn(page, JOURNEY_ACCOUNTS.security);
  await page.goto("/today");
  await Promise.all([
    page.waitForURL("**/"),
    page.getByRole("button", { name: "Sign out" }).click(),
  ]);

  await page.goto("/companies");
  // A signed-out visitor is offered the door, not the data.
  await expect(page.getByText(SECRET_COMPANY)).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/");
});

test("a wrong password does not open the workspace", async ({ page }) => {
  const response = await page.request.post(`${BASE_URL}/api/auth/login`, {
    data: {
      username: JOURNEY_ACCOUNTS.security.username,
      password: `${ACCOUNT_PASSWORD}-wrong`,
    },
    headers: { Origin: BASE_URL },
    failOnStatusCode: false,
  });

  expect(response.status()).toBeGreaterThanOrEqual(400);
  // The message must not distinguish "no such user" from "wrong password".
  const body = await response.text();
  expect(body.toLowerCase()).not.toContain("no such");
  expect(body.toLowerCase()).not.toContain("does not exist");
});

import { type Locator, type Page, expect } from "@playwright/test";

import { ACCOUNT_PASSWORD, BASE_URL } from "../shared";

export { ACCOUNT_PASSWORD, BASE_URL };

/**
 * One account per journey file. The suite runs with a single worker, but these
 * journeys write as much as they read, so isolating them by workspace rather
 * than by ordering means a failure leaves the next file a clean starting point
 * — and it keeps every assertion honestly tenant-scoped.
 */
export type JourneyAccount = {
  userId: string;
  workspaceId: string;
  username: string;
  displayName: string;
  /** Seeded with a company, contact and role post rather than starting empty. */
  seeded?: boolean;
};

export const JOURNEY_ACCOUNTS = {
  pipeline: {
    userId: "journey-user-pipeline",
    workspaceId: "journey-workspace-pipeline",
    username: "journey_pipeline",
    displayName: "Journey Pipeline",
  },
  networking: {
    userId: "journey-user-networking",
    workspaceId: "journey-workspace-networking",
    username: "journey_networking",
    displayName: "Journey Networking",
  },
  referral: {
    userId: "journey-user-referral",
    workspaceId: "journey-workspace-referral",
    username: "journey_referral",
    displayName: "Journey Referral",
  },
  planning: {
    userId: "journey-user-planning",
    workspaceId: "journey-workspace-planning",
    username: "journey_planning",
    displayName: "Journey Planning",
  },
  records: {
    userId: "journey-user-records",
    workspaceId: "journey-workspace-records",
    username: "journey_records",
    displayName: "Journey Records",
  },
  security: {
    userId: "journey-user-security",
    workspaceId: "journey-workspace-security",
    username: "journey_security",
    displayName: "Journey Security",
  },
  neighbour: {
    userId: "journey-user-neighbour",
    workspaceId: "journey-workspace-neighbour",
    username: "journey_neighbour",
    displayName: "Journey Neighbour",
  },
} as const satisfies Record<string, JourneyAccount>;

/**
 * Sign in through the API rather than the dialog. The sign-in form has its own
 * journey in `account.spec.ts`; every other file is testing what happens after
 * it, and re-driving the dialog each time would only make those failures point
 * at the wrong screen.
 */
export async function signIn(page: Page, account: JourneyAccount) {
  const response = await page.request.post(`${BASE_URL}/api/auth/login`, {
    data: { username: account.username, password: ACCOUNT_PASSWORD },
    headers: { Origin: BASE_URL },
  });
  expect(
    response.status(),
    `sign in as ${account.username}`,
  ).toBe(200);
}

/**
 * Journeys assert against dates the running server would call "today", not
 * against the fixture's frozen clock — the seed is days old by the time anyone
 * runs this, and a follow-up dated in the past lands in Overdue rather than
 * Today. Workspaces default to Asia/Kolkata (D-036), which is the zone the
 * server resolves a calendar date in.
 */
export const WORKSPACE_ZONE = "Asia/Kolkata";

export function workspaceDate(offsetDays = 0): string {
  const at = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: WORKSPACE_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * Open a disclosure-backed create form and return it as a scope. Several list
 * screens carry a filter form using the same field names as the create form —
 * "Company" appears in both — so every journey fills fields inside the returned
 * locator rather than against the page, which would be ambiguous.
 */
export async function openCreateForm(
  page: Page,
  toggle: string,
  containerId: string,
  firstField: string,
) {
  const control = page.getByRole("button", { name: toggle, exact: true });
  if ((await control.getAttribute("aria-expanded")) !== "true") {
    await control.click();
  }
  const form = page.locator(`#${containerId}`);
  await expect(form.getByLabel(firstField, { exact: true })).toBeVisible();
  return form;
}

/**
 * Click a control that writes, and do not continue until the write has landed.
 *
 * Navigating straight after a click aborts the in-flight request: the row is
 * never created and the journey then fails somewhere else entirely, which reads
 * like a product bug and is not one. Every save in these specs goes through
 * here so that trap is closed once rather than remembered each time.
 *
 * The status assertion is deliberate — a 4xx that the page renders as a quiet
 * inline message would otherwise show up much later as a missing row.
 */
export async function saveAndSettle(
  page: Page,
  control: Locator,
  apiPath: string,
) {
  const settled = page.waitForResponse(
    (response) =>
      response.url().includes(apiPath) && response.request().method() !== "GET",
  );
  await control.click();
  const response = await settled;
  expect(
    response.ok(),
    `${response.request().method()} ${apiPath} -> ${response.status()}`,
  ).toBe(true);
  return response;
}

/**
 * Every mutation in this product round-trips through a route handler and then a
 * server-rendered refresh, so "the row exists" is only true once the new markup
 * has arrived. Waiting on the text rather than a timeout keeps the journeys
 * honest about what the user would actually see.
 */
export async function expectRow(page: Page, text: string) {
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible({
    timeout: 15_000,
  });
}

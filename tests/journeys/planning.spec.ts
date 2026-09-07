import { expect, test } from "@playwright/test";

import {
  JOURNEY_ACCOUNTS,
  saveAndSettle,
  signIn,
  workspaceDate,
} from "./fixture";

/**
 * What a person opens the app to answer: what do I do today, and what did I let
 * slip. Tasks are the manual half of that and notifications are the derived
 * half, so both are driven here — including the states that are easy to ship
 * broken, like a completed task that keeps reappearing.
 */
test.describe.configure({ mode: "serial" });

const TASK = "Draft outreach note for Halcyon";
const OVERDUE_TASK = "Chase the recruiter reply";

test.beforeEach(async ({ page }) => {
  await signIn(page, JOURNEY_ACCOUNTS.planning);
});

test("an empty Today says what to do rather than showing a blank page", async ({
  page,
}) => {
  await page.goto("/today");
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  const doNow = page.getByRole("region", { name: "Do Now" });
  await expect(doNow).toBeVisible();
  // An empty queue is the normal state on day one and after a good day; it must
  // read as finished, not as broken.
  await expect(doNow.getByText(/nothing|clear|caught up|no /i).first()).toBeVisible();
});

test("a task due today lands on Today and in the Today filter", async ({ page }) => {
  await page.goto("/tasks");
  await page.getByLabel("Title", { exact: true }).fill(TASK);
  await page.getByLabel("Due date", { exact: true }).fill(workspaceDate());
  await page.getByLabel("Priority", { exact: true }).selectOption("high");
  await page.getByRole("button", { name: "Add task" }).click();

  // The task has to appear without a reload, and the form must not claim the
  // save failed. Both halves matter: the create route can return 201 while the
  // form still reports "could not reach Job Pilot", which reads as a failure
  // and invites the user to submit the same task again.
  await expect(page.getByText(TASK).first()).toBeVisible();
  await expect(page.locator(".form-alert")).toHaveCount(0);

  await page.goto("/tasks?due=today");
  await expect(page.getByText(TASK).first()).toBeVisible();

  await page.goto("/today");
  await expect(
    page.getByRole("region", { name: "Do Now" }).getByText(TASK).first(),
  ).toBeVisible();
});

test("a task dated in the past is called overdue, not just listed", async ({
  page,
}) => {
  await page.goto("/tasks");
  await page.getByLabel("Title", { exact: true }).fill(OVERDUE_TASK);
  await page.getByLabel("Due date", { exact: true }).fill(workspaceDate(-3));
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText(OVERDUE_TASK).first()).toBeVisible();

  await page.goto("/tasks?due=overdue");
  await expect(page.getByText(OVERDUE_TASK).first()).toBeVisible();

  // And it must not hide inside Later, which is where an off-by-one in the
  // date comparison would put it.
  await page.goto("/tasks?due=later");
  await expect(page.getByText(OVERDUE_TASK)).toHaveCount(0);
});

test("completing a task clears it from Today and files it under Completed", async ({
  page,
}) => {
  await page.goto("/tasks");
  const row = page
    .locator("li, tr, article")
    .filter({ hasText: TASK })
    .filter({ has: page.getByRole("button", { name: "Complete" }) })
    .first();
  await saveAndSettle(
    page,
    row.getByRole("button", { name: "Complete" }),
    "/api/tasks/",
  );

  await page.goto("/tasks?status=completed");
  await expect(page.getByText(TASK).first()).toBeVisible();

  await page.goto("/today");
  await expect(
    page.getByRole("region", { name: "Do Now" }).getByText(TASK),
  ).toHaveCount(0);
});

test("a derived notification can be snoozed out of the way", async ({ page }) => {
  await page.goto("/notifications");
  const snooze = page.getByRole("button", { name: "Snooze Tomorrow" }).first();

  // The overdue task above is what produces something to act on here; if the
  // derivation ever stops running this assertion is the first to say so.
  await expect(snooze).toBeVisible();
  const before = await page.getByRole("button", { name: "Mark done" }).count();
  await snooze.click();

  await expect
    .poll(async () => page.getByRole("button", { name: "Mark done" }).count())
    .toBeLessThan(before);
});
